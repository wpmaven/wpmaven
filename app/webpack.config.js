const path = require('path');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const { DefinePlugin } = require('webpack');

// Check which build mode we're in
const BUILD_TARGET = process.env.BUILD_TARGET || 'all';

// Define entry points
// Note: 'app' entry (floating chat widget) removed — the dashboard is now the single UI entry point.
const entryPoints = {
  dashboard: './src/DashboardApp.tsx',
};

// Filter entries based on build target
const getEntries = () => {
  if (BUILD_TARGET === 'all') {
    return entryPoints;
  }
  if (entryPoints[BUILD_TARGET]) {
    return { [BUILD_TARGET]: entryPoints[BUILD_TARGET] };
  }
  return entryPoints;
};

// The setup wizard's package and the screens shared with the dashboard
// (@yotako/wpmaven-screens) ship compiled (ES2020): babel leaves them as
// they are, whether npm links them from a folder or installs them from the
// registry.
const WIZARD_PACKAGE_DIST = /wpmaven-(onboarding|screens)[\\/]dist[\\/]/;

// The app's own code (src/), which the shared lazy chunk below takes from.
const APP_SOURCES = path.resolve(__dirname, 'src') + path.sep;

// The browsers babel compiles the app's own code for. The bundle already
// ships the kit's, the wizard's and the charts' code as their packages build
// it (logical assignment, class fields, optional chaining), which these
// versions are the first to run: compiling the app's code down to ES5 (the
// preset's default without targets) only made every script bigger, for no
// browser that could run the rest of the bundle.
const BROWSER_TARGETS = 'chrome >= 85, edge >= 85, firefox >= 79, safari >= 14, ios_saf >= 14, opera >= 71, samsung >= 14';

// The scripts a production build minifies without NODE_ENV=production. The
// setup wizard's chunk always ships minified (an ES library build keeps its
// whitespace). npm run build sets NODE_ENV=production, and then every script
// is minified (MinifyOnly steps aside).
const MINIFIED_SCRIPTS = /^onboarding\.js$/;

/**
 * Keeps webpack's own minimizer to the scripts MINIFIED_SCRIPTS names: just
 * before it runs, every other script is marked as already minimized, which
 * is the mark the minimizer skips. A development build (npm run dev)
 * minifies nothing.
 */
class MinifyOnly {
  constructor(test) {
    this.test = test;
  }

  apply(compiler) {
    if (process.env.NODE_ENV === 'production') return;
    const keepAll = compiler.options.mode !== 'production';
    const { Compilation } = compiler.webpack;
    compiler.hooks.thisCompilation.tap('MinifyOnly', (compilation) => {
      compilation.hooks.processAssets.tap(
        { name: 'MinifyOnly', stage: Compilation.PROCESS_ASSETS_STAGE_OPTIMIZE_SIZE - 1 },
        () => {
          for (const asset of compilation.getAssets()) {
            // A lazy chunk's asset name ends in its URL's query (chunkFilename).
            const file = asset.name.split('?')[0];
            const keep = keepAll || !this.test.test(file);
            if (/\.js$/.test(file) && keep && !asset.info.minimized) {
              compilation.updateAsset(asset.name, asset.source, { minimized: true });
            }
          }
        },
      );
    });
  }
}

/**
 * Minifies the stylesheets of a production build, which webpack's minimizer
 * leaves alone (it minifies scripts): the kit's and the wizard's come
 * minified, the app's own do not. Comments (but /*! notes) and the
 * whitespace around rules and declarations go. postcss (css-loader's own
 * parser) reads and writes every selector, value and at-rule as written:
 * only a line break inside one goes, after a comma, or becomes a space.
 */
class MinifyStyles {
  apply(compiler) {
    if (compiler.options.mode !== 'production') return;
    const postcss = require('postcss');
    const { Compilation, sources } = compiler.webpack;
    const oneLine = (text) => text.replace(/,\s*\n\s*/g, ',').replace(/\s*\n\s*/g, ' ');
    compiler.hooks.thisCompilation.tap('MinifyStyles', (compilation) => {
      compilation.hooks.processAssets.tap(
        { name: 'MinifyStyles', stage: Compilation.PROCESS_ASSETS_STAGE_OPTIMIZE_SIZE },
        () => {
          for (const asset of compilation.getAssets()) {
            if (!/\.css$/.test(asset.name.split('?')[0]) || asset.info.minimized) continue;
            const root = postcss.parse(asset.source.source().toString(), { from: asset.name });
            root.walkComments((comment) => {
              if (!comment.text.startsWith('!')) comment.remove();
            });
            root.walk((node) => {
              node.raws.before = '';
              if (node.type === 'decl') {
                node.raws.between = ':';
                if (node.value.includes('\n')) node.value = oneLine(node.value);
                if (node.important) node.raws.important = '!important';
              } else if (node.type === 'rule') {
                node.raws.between = '';
                node.raws.after = '';
                node.raws.semicolon = false;
                if (node.selector.includes('\n')) node.selector = oneLine(node.selector);
              } else if (node.type === 'atrule') {
                node.raws.between = '';
                node.raws.after = '';
                node.raws.semicolon = false;
                node.raws.afterName = node.params ? ' ' : '';
                if (node.params.includes('\n')) node.params = oneLine(node.params);
              }
            });
            root.raws.after = '';
            root.raws.semicolon = false;
            compilation.updateAsset(asset.name, new sources.RawSource(root.toString()), { minimized: true });
          }
        },
      );
    });
  }
}

module.exports = {
  entry: getEntries(),
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name].js',
    // A lazy chunk ships under its name (onboarding.js, wm-store.js), and
    // the runtime asks for it with its content hash in the query, the
    // way WordPress versions dashboard.js itself (?ver=<version>.<mtime>).
    // The plugin's files come with no Cache-Control, so a browser keeps
    // using a chunk it fetched before a rebuild or an update: next to the
    // new dashboard.js, an older chunk requires module ids the new runtime
    // no longer has ("e[r] is undefined"). A chunk that changes gets a new
    // URL; one that does not stays cached.
    chunkFilename: '[name].js?ver=[contenthash:8]',
    clean: true,
    // publicPath is set dynamically at runtime for lazy-loaded chunks
  },
  module: {
    rules: [
      {
        test: /\.(js|jsx|ts|tsx)$/,
        exclude: [/node_modules\/(?!webmaven-ui)/, WIZARD_PACKAGE_DIST],
        use: {
          loader: 'babel-loader',
          options: {
            presets: [
              ['@babel/preset-env', { targets: BROWSER_TARGETS, bugfixes: true }],
              '@babel/preset-react',
              '@babel/preset-typescript'
            ]
          }
        }
      },
      {
        test: /\.module\.css$/,
        use: [
          process.env.EMBED_CSS === 'true' ? 'style-loader' : MiniCssExtractPlugin.loader,
          {
            loader: 'css-loader',
            options: {
              modules: {
                localIdentName: '[name]__[local]--[hash:base64:5]',
                exportLocalsConvention: 'asIs',
              },
            },
          },
        ],
      },
      {
        test: /\.css$/,
        exclude: /\.module\.css$/,
        use: [
          process.env.EMBED_CSS === 'true' ? 'style-loader' : MiniCssExtractPlugin.loader,
          'css-loader'
        ]
      },
      {
        test: /\.(png|jpg|jpeg|gif|svg|webp|avif)$/,
        type: 'asset/resource',
        generator: {
          // Flat filename — the WP plugin serves the dist/ contents from
          // its own `assets/` folder, so an `assets/` prefix here would
          // produce `assets/assets/<file>` URLs at runtime.
          filename: '[name][ext]'
        }
      }
    ]
  },
  plugins: [
    ...(process.env.EMBED_CSS !== 'true' ? [
      new MiniCssExtractPlugin({
        filename: '[name].css',
        // A lazy chunk's stylesheet, like its script (output.chunkFilename).
        chunkFilename: '[name].css?ver=[contenthash:8]',
      })
    ] : []),
    new MinifyOnly(MINIFIED_SCRIPTS),
    new MinifyStyles(),
    // Which plugin the app is built for (build.sh --edition): 'wporg' leaves
    // the setup wizard's chunk out (the dashboard sets a business up).
    new DefinePlugin({
      __WPMAVEN_EDITION__: JSON.stringify(process.env.WPMAVEN_EDITION === 'wporg' ? 'wporg' : 'full'),
    }),
  ],
  resolve: {
    extensions: ['.js', '.jsx', '.ts', '.tsx'],
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@components': path.resolve(__dirname, 'src/components'),
      '@contexts': path.resolve(__dirname, 'src/contexts'),
      '@services': path.resolve(__dirname, 'src/services'),
      '@utils': path.resolve(__dirname, 'src/utils'),
      '@styles': path.resolve(__dirname, 'src/styles'),
      '@hooks': path.resolve(__dirname, 'src/hooks'),
      '@types': path.resolve(__dirname, 'src/types')
    },
    // This app's node_modules first, for every import, the setup wizard
    // package's and the shared screens' too: react/jsx-runtime,
    // @yotako/webmaven-ui, the wizard's shared helpers (one product name,
    // set once), lucide-react, react-icons, dompurify and prismjs exist once
    // in the bundle, even when npm links a package from a folder that has a
    // node_modules of its own.
    modules: [path.resolve(__dirname, 'node_modules'), 'node_modules'],
  },
  externals: {
    'react': 'window.React',
    'react-dom': 'window.ReactDOM',
    'marked': 'window.marked'
  },
  optimization: {
    // Webpack's own minimizer. With NODE_ENV=production (npm run build)
    // MinifyOnly steps aside and every script is minified; a bare
    // `webpack --mode production` still minifies the setup wizard's chunk;
    // a development build minifies nothing. Stylesheets: MinifyStyles.
    minimize: true,
    // One bundle for the app itself (WordPress loads a single script). The
    // only splits: the Store, Blog, Media and Messages screens (lazy chunks)
    // share one chunk of their common pieces instead of a copy each, and
    // what else of the app's own code two lazy chunks or more need (the
    // product mapper of the Store and the editor, the dialogs, badges and
    // text helpers of the content screens) is one more shared chunk. The
    // setup wizard's lazy chunk (onboarding) stays whole.
    splitChunks: {
      chunks: 'async',
      cacheGroups: {
        default: false,
        defaultVendors: false,
        storeShared: {
          test: /[\\/]src[\\/](components[\\/]Dashboard[\\/]store[\\/]shared[\\/]|types[\\/]store\.ts$)/,
          name: 'wm-store-shared',
          chunks: 'async',
          minChunks: 2,
          minSize: 0,
          enforce: true,
        },
        asyncShared: {
          test: (module) => typeof module.resource === 'string' && module.resource.startsWith(APP_SOURCES),
          name: 'wm-shared',
          chunks: (chunk) => chunk.name !== 'onboarding',
          minChunks: 2,
          minSize: 0,
          enforce: true,
          priority: -10,
        },
      },
    },
    runtimeChunk: false,
  },
  // Performance hints: the app's own budget, its bundle as it is (2026-10-19:
  // dashboard.js 1.25 MiB, 1.37 MiB with dashboard.css) and some room, so a
  // build warns only when a release grows it. What a screen adds belongs in
  // a lazy chunk; the zip's budget (build.sh) holds everything together.
  performance: {
    hints: process.env.NODE_ENV === 'production' ? 'warning' : false,
    maxEntrypointSize: 1500 * 1024,
    maxAssetSize: 1400 * 1024,
  },
};

// ── The shared packages from their source ──────────────────────────────────
//
// WEBMAVEN_UI_SRC names a checkout of webmaven-ui at the versions the plugin
// pins: the kit (@yotako/webmaven-ui), the setup wizard's shared helpers
// (@yotako/wpmaven-onboarding/shared) and the screens shared with the
// dashboard (@yotako/wpmaven-screens) are then compiled from their source,
// not from their dist/. The WordPress.org edition always builds this way:
// its source is public, and the module list (MODULE_LIST_OUT) names every
// file the bundle used, the packages' own included, which the release copies
// to the public repository.

const UI_SRC = process.env.WEBMAVEN_UI_SRC ? path.resolve(process.env.WEBMAVEN_UI_SRC) : null;
if (process.env.WPMAVEN_EDITION === 'wporg' && !UI_SRC) {
  throw new Error('The WordPress.org edition compiles the shared packages from their source: set WEBMAVEN_UI_SRC to webmaven-ui at the pinned versions.');
}

function applySourcePackages(config, uiSrc) {
  const kit = path.join(uiSrc, 'src'); // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal (WEBMAVEN_UI_SRC, the build's own checkout of webmaven-ui)
  const onboarding = path.join(uiSrc, 'packages/wpmaven-onboarding/src'); // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal (WEBMAVEN_UI_SRC, the build's own checkout of webmaven-ui)
  const screens = path.join(uiSrc, 'packages/wpmaven-screens/src'); // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal (WEBMAVEN_UI_SRC, the build's own checkout of webmaven-ui)
  const sources = [kit, onboarding, screens];
  const empty = path.resolve(__dirname, 'build/empty.css');
  const versionOf = (dir) => require(path.join(dir, '..', 'package.json')).version; // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal (WEBMAVEN_UI_SRC, the build's own checkout of webmaven-ui)

  // The app's own rules leave the packages' source to theirs.
  const jsRule = config.module.rules[0];
  jsRule.exclude = [].concat(jsRule.exclude || [], sources);
  const cssModules = config.module.rules.find((r) => String(r.test) === String(/\.module\.css$/));
  cssModules.exclude = sources;

  const babel = {
    loader: 'babel-loader',
    options: {
      babelrc: false,
      configFile: false,
      presets: [
        ['@babel/preset-env', { targets: BROWSER_TARGETS, bugfixes: true }],
        ['@babel/preset-react', { runtime: 'automatic' }],
        '@babel/preset-typescript',
      ],
    },
  };
  const cssModulesNamed = (localIdentName) => [
    process.env.EMBED_CSS === 'true' ? 'style-loader' : MiniCssExtractPlugin.loader,
    { loader: 'css-loader', options: { modules: { localIdentName, exportLocalsConvention: 'asIs' } } },
  ];
  config.module.rules.unshift(
    // The kit: its '@' alias, and Vite's default class names (_local_hash), which the app's CSS matches.
    { test: /\.(ts|tsx|js|jsx)$/, include: kit, use: babel, resolve: { alias: { '@': kit } } },
    { test: /\.module\.css$/, include: kit, use: cssModulesNamed('_[local]_[hash:base64:5]') },
    // The wizard's helpers and the screens: their own class prefixes.
    { test: /\.(ts|tsx|js|jsx)$/, include: [onboarding, screens], use: babel },
    { test: /\.module\.css$/, include: onboarding, use: cssModulesNamed('wmo_[local]_[hash:base64:5]') },
    { test: /\.module\.css$/, include: screens, use: cssModulesNamed('wms_[local]_[hash:base64:5]') },
  );
  config.resolve.alias = {
    ...config.resolve.alias,
    '@yotako/webmaven-ui$': path.join(kit, 'index.ts'), // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal (WEBMAVEN_UI_SRC, the build's own checkout of webmaven-ui)
    '@yotako/webmaven-ui/style.css': empty,
    '@yotako/wpmaven-onboarding$': path.join(onboarding, 'index.ts'), // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal (WEBMAVEN_UI_SRC, the build's own checkout of webmaven-ui)
    '@yotako/wpmaven-onboarding/shared': path.join(onboarding, 'shared.ts'), // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal (WEBMAVEN_UI_SRC, the build's own checkout of webmaven-ui)
    '@yotako/wpmaven-onboarding/style.css': empty,
    '@yotako/wpmaven-screens$': path.join(screens, 'index.ts'), // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal (WEBMAVEN_UI_SRC, the build's own checkout of webmaven-ui)
    '@yotako/wpmaven-screens/approvals': path.join(screens, 'approvals.ts'), // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal (WEBMAVEN_UI_SRC, the build's own checkout of webmaven-ui)
    '@yotako/wpmaven-screens/team': path.join(screens, 'team.ts'), // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal (WEBMAVEN_UI_SRC, the build's own checkout of webmaven-ui)
    '@yotako/wpmaven-screens/home': path.join(screens, 'home.ts'), // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal (WEBMAVEN_UI_SRC, the build's own checkout of webmaven-ui)
  };
  config.plugins.push(new DefinePlugin({
    __WIZARD_VERSION__: JSON.stringify(versionOf(onboarding)),
    __SCREENS_VERSION__: JSON.stringify(versionOf(screens)),
  }));
}

/**
 * Writes to `out` every source file the build used (the app's and the
 * packages', as absolute paths, with the roots they sit under) and every npm
 * package the bundle took code from, with its installed version.
 */
class ModuleList {
  constructor(out, roots) {
    this.out = out;
    this.roots = roots;
  }

  apply(compiler) {
    compiler.hooks.done.tap('ModuleList', (stats) => {
      const fs = require('fs');
      // The modules in the bundle only: a file webpack read but left out (an
      // export nothing uses, from a package without side effects) is not
      // published.
      const json = stats.toJson({ modules: true, orphanModules: false, chunks: false, source: false, reasons: false });
      const files = new Set();
      const visit = (m) => {
        if (m.nameForCondition) files.add(m.nameForCondition.split('?')[0]);
        (m.modules || []).forEach(visit);
      };
      (json.modules || []).forEach(visit);
      const marker = `${path.sep}node_modules${path.sep}`;
      const packages = {};
      for (const file of files) {
        const at = file.indexOf(marker);
        if (at < 0) continue;
        const parts = file.slice(at + marker.length).split(path.sep);
        const name = parts[0].startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0];
        if (packages[name]) continue;
        const manifest = path.join(file.slice(0, at + marker.length), name, 'package.json');
        packages[name] = JSON.parse(fs.readFileSync(manifest, 'utf8')).version;
      }
      const list = [...files].filter((f) => !f.includes(marker)).sort();
      fs.writeFileSync(this.out, JSON.stringify({ roots: this.roots, files: list, packages }, null, 1));
    });
  }
}

if (UI_SRC) {
  applySourcePackages(module.exports, UI_SRC);
}
if (process.env.MODULE_LIST_OUT) {
  module.exports.plugins.push(new ModuleList(path.resolve(process.env.MODULE_LIST_OUT), { app: __dirname, ui: UI_SRC }));
}
