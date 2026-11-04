/**
 * WebMaven frame script
 *
 * Runs inside the editor's site iframe when ?webmaven_discover=1 is present.
 * Builds the element map the editor window selects from (headings,
 * paragraphs, buttons, images, sections...), and the bindings that give each
 * one its address in the edit engine (its section, the header or footer, a
 * card, a menu item, a fact, an image). Tracks positions, handles hover,
 * click and typing on the page, shows previews in place, and talks to the
 * editor through postMessage.
 */
(function () {
	'use strict';

	// Only run inside an iframe.
	if (window === window.top) return;

	/** @type {Map<string, ElementEntry>} */
	var elementMap = new Map();

	/** @type {WeakMap<Element, ElementEntry>} O(1) element→entry lookup. */
	var elementLookup = new WeakMap();

	/** @type {number|null} Debounce timer for MutationObserver. */
	var rebuildTimer = null;

	/** @type {boolean} Suppress observer during preview operations. */
	var suppressObserver = false;

	/**
	 * What the editor asked for: 'legacy' (the element map, wme:request-map)
	 * or 'bindings' (a site WPMaven built, wme:request-bindings). Nothing is
	 * mapped or annotated before the editor asks.
	 * @type {null|'legacy'|'bindings'}
	 */
	var mode = null;

	/** The element map also carries the bindings (the editor window: wme:request-map with bindings). */
	var withBindings = false;

	/**
	 * 'template': the product page or the post page itself (wme:request-map
	 * with mode 'template', 2026-10-19): the record shown is an example, its
	 * own parts dim, and the design every product (or post) prints with is
	 * what changes. '' for the page, post and product editors.
	 */
	var viewMode = '';

	/** What a crossing note or the window's crossing action started from: selected again once the other editor maps the page. */
	var crossNode = null;

	// ── Build Element Map ──────────────────────────────────────────────

	/**
	 * Extract the page/post ID from body classes, meta, or article wrapper.
	 */
	function detectPagePostId() {
		// WordPress adds postid-N or page-id-N to <body>.
		var bodyMatch = document.body.className.match(/\b(?:postid|page-id)-(\d+)\b/);
		if (bodyMatch) return bodyMatch[1];
		// Fallback: <article id="post-N">.
		var article = document.querySelector('article[id^="post-"]');
		if (article) {
			var m = article.id.match(/^post-(\d+)$/);
			if (m) return m[1];
		}
		return '';
	}

	// Collect every data-wme-* attribute on an element into a flat map (keys
	// without the "data-wme-" prefix). This lets source-specific routing
	// attributes — wc-field, wpforms-form-id, wpforms-field-id, wpforms-prop,
	// gf-form-id, gf-field-id, gf-prop, setting-source, template-slug,
	// global-style-target, binding-source/key, etc. — reach the editor without
	// hardcoding each one. The editor reads entry.attrs to build the precise
	// apply-change request (target_type + its params).
	function collectWmeAttrs(el) {
		var out = {};
		if (!el || !el.attributes) return out;
		for (var i = 0; i < el.attributes.length; i++) {
			var name = el.attributes[i].name;
			if (name.indexOf('data-wme-') === 0) {
				out[name.slice(9)] = el.attributes[i].value;
			}
		}
		return out;
	}

	/**
	 * Where a change to this element is saved, from the server's annotations:
	 * the template part it sits in (template-part handler), the site setting
	 * it renders (site-identity handler), its menu item, its WooCommerce term.
	 */
	function routingOf(el) {
		var out = {};
		if (!el || !el.getAttribute) return out;
		var part = el.closest ? el.closest('[data-wme-template-slug]') : null;
		if (part) out.templateSlug = part.getAttribute('data-wme-template-slug') || '';
		// The block's mark and owner: the handler refuses a block at the path that is not this one.
		if (el.getAttribute('data-wme-block-sig')) out.blockSig = el.getAttribute('data-wme-block-sig');
		if (el.getAttribute('data-wme-owner')) out.owner = el.getAttribute('data-wme-owner');
		if (el.getAttribute('data-wme-setting-target') === 'site-identity' && el.getAttribute('data-wme-setting-source')) {
			out.settingKey = el.getAttribute('data-wme-setting-source');
		}
		var item = el.closest ? el.closest('[data-wme-menu-item-id]') : null;
		if (item) out.menuItemId = item.getAttribute('data-wme-menu-item-id') || '';
		if (el.getAttribute('data-wme-wc-term-id')) out.wcTermId = el.getAttribute('data-wme-wc-term-id');
		return out;
	}

	function buildElementMap() {
		elementMap.clear();
		elementLookup = new WeakMap();

		var pagePostId = detectPagePostId();
		designedSite = !!document.querySelector('[data-wm-section], [data-wm-chrome], [data-wm-page]');

		// 1. Annotated elements (from PHP render_block filter).
		var annotated = document.querySelectorAll('[data-wme-source]');
		for (var i = 0; i < annotated.length; i++) {
			var el = annotated[i];
			// Skip invisible elements (display:none → zero-size rect).
			var elRect = el.getBoundingClientRect();
			if (elRect.width === 0 && elRect.height === 0 && el.tagName !== 'BODY' && el.tagName !== 'HTML') continue;

			var uid = el.getAttribute('data-wme-block-uid') || generateFallbackId(el);
			// A section of a page WPMaven designed (a Custom HTML block): a section, its words mapped inside.
			var designed = el.getAttribute('data-wme-designed') === 'true';
			// The page's first block opens its wrapper: that element holds every section, the page itself.
			if (designed && wrapsSections(el)) continue;
			var entry = {
				el: el,
				source: el.getAttribute('data-wme-source') || 'unknown',
				blockName: el.getAttribute('data-wme-block-name') || '',
				blockUid: uid,
				postId: el.getAttribute('data-wme-post-id') || '',
				category: designed ? 'layout-section' : (el.getAttribute('data-wme-category') || 'unknown'),
				editable: !designed && el.getAttribute('data-wme-editable') === 'true',
				attrs: collectWmeAttrs(el),
				rect: getElementRect(el),
			};
			elementMap.set(uid, entry);
			elementLookup.set(el, entry);
		}

		// 2. Fallback: semantic HTML heuristics for unannotated content.
		var semanticSelectors = 'h1, h2, h3, h4, h5, h6, p, img, nav, header, footer, main, article, section, figure, blockquote, table, ul, ol, button';
		var semanticEls = document.querySelectorAll(semanticSelectors);
		for (var j = 0; j < semanticEls.length; j++) {
			var sel = semanticEls[j];
			// Skip if already mapped via annotations or inside an annotated block
			// (a designed section's own words are mapped like any page's).
			if (elementLookup.has(sel) || insideAnnotatedBlock(sel) || wrapsSections(sel)) continue;
			if (sel.offsetHeight < 5) continue;

			var fallbackId = generateFallbackId(sel);
			var tag = sel.tagName.toLowerCase();

			// Write fallback ID to DOM for fast lookup.
			sel.setAttribute('data-wme-fallback-id', fallbackId);

			var semEntry = {
				el: sel,
				source: 'semantic',
				blockName: '',
				blockUid: fallbackId,
				postId: pagePostId,
				category: categorizeSemanticElement(tag),
				editable: /^(h[1-6]|p|button)$/.test(tag),
				rect: getElementRect(sel),
			};
			elementMap.set(fallbackId, semEntry);
			elementLookup.set(sel, semEntry);
		}

		// 2b. Button-like anchor elements (theme CTAs, styled links).
		var btnAnchors = document.querySelectorAll(
			'a[class*="btn"], a[class*="button"], a[class*="cta"], a[role="button"], a.wp-element-button, a.wp-block-button__link'
		);
		for (var b = 0; b < btnAnchors.length; b++) {
			var btn = btnAnchors[b];
			if (insideAnnotatedBlock(btn)) continue;
			if (elementLookup.has(btn)) continue;
			if (btn.offsetHeight < 5) continue;
			// Skip links inside navigation elements.
			if (btn.closest('nav, [role="navigation"]')) continue;

			var btnId = generateFallbackId(btn);
			btn.setAttribute('data-wme-fallback-id', btnId);
			var btnEntry = {
				el: btn,
				source: 'semantic',
				blockName: '',
				blockUid: btnId,
				postId: pagePostId,
				category: 'text-button',
				editable: true,
				rect: getElementRect(btn),
			};
			elementMap.set(btnId, btnEntry);
			elementLookup.set(btn, btnEntry);
		}

		// 2c. The row or grid holding live cards (products from the store, the
		//     latest posts): one part of its own, outlined as a list; and each
		//     card, whatever its tag.
		var cards = document.querySelectorAll(LIVE_CARDS);
		for (var c = 0; c < cards.length; c++) {
			var card = cards[c];
			if (!elementLookup.has(card) && !insideAnnotatedBlock(card) && card.offsetHeight >= 5) {
				addEntry(card, 'layout-section', false, pagePostId);
			}
			var holder = card.parentElement;
			if (!holder || holder === document.body || elementLookup.has(holder)) continue;
			if (liveCardsIn(holder) < 2 || insideAnnotatedBlock(holder) || holder.offsetHeight < 5) continue;
			var holderId = generateFallbackId(holder);
			holder.setAttribute('data-wme-fallback-id', holderId);
			var holderEntry = {
				el: holder,
				source: 'semantic',
				blockName: '',
				blockUid: holderId,
				postId: pagePostId,
				category: 'layout-section',
				editable: false,
				rect: getElementRect(holder),
			};
			elementMap.set(holderId, holderEntry);
			elementLookup.set(holder, holderEntry);
		}

		// 2d. Forms (a designed form, a form plugin's): one part of their own.
		var formEls = document.querySelectorAll(ANY_FORM);
		for (var f = 0; f < formEls.length; f++) {
			var formEl = formEls[f];
			if (elementLookup.has(formEl) || (formEl.parentElement && formEl.parentElement.closest(ANY_FORM))) continue;
			if (insideAnnotatedBlock(formEl) || formEl.offsetHeight < 5) continue;
			var formId = generateFallbackId(formEl);
			formEl.setAttribute('data-wme-fallback-id', formId);
			var formEntry = {
				el: formEl,
				source: 'semantic',
				blockName: '',
				blockUid: formId,
				postId: pagePostId,
				category: 'interactive',
				editable: false,
				rect: getElementRect(formEl),
			};
			elementMap.set(formId, formEntry);
			elementLookup.set(formEl, formEntry);
		}

		// 3. Detect third-party builder elements.
		detectElementorWidgets();
		detectDiviModules();
		detectKadenceBlocks();
		detectSpectraBlocks();
		detectGenerateBlocks();
		detectBeaverBuilderModules();
		detectWooCommerceElements();

		// 4. Auto-discover un-mapped content elements inside layout containers.
		//    Layout blocks (covers, sections, groups) may contain elements like
		//    background <img> tags, inline <a> links, or other content that
		//    isn't a separate annotated block.  Map them so findMappedElement
		//    can select them individually instead of always selecting the container.
		discoverInnerContentElements();

		// 5. What a designed page holds besides its words: a form's fields and
		//    their labels, an embed (a map, a video), and each section's own
		//    parts (its cards, grids, rows and groups), so they are selected
		//    on their own instead of the whole section (2026-10-18).
		mapFields(pagePostId);
		mapEmbeds(pagePostId);
		mapLinks(pagePostId);
		mapSectionParts(pagePostId);

		// 6. WooCommerce's gallery is one part, its thumbnails each a picture;
		//    then nothing the visitor cannot see stays a part.
		mapGalleries(pagePostId);
		dropUnseen();

		// 7. A post's or a product's own page: only its own content stays a part;
		//    the product page or the post page itself: everything but it.
		if (viewMode === 'template') keepTemplate();
		else keepOwnContent();

		// 8. What a part prints on beyond this page (the Template tag), and a category's own words.
		markShared();

		// single: the post editor or the product editor (only its own content is a part);
		// view: the page is a post's or a product's own, whatever it shows;
		// mode: 'template' when the page is the product page or the post page itself.
		var single = viewMode !== 'template' && singleView() && ownContent(singleView()) ? singleView() : null;
		notifyParent('wme:map-ready', { count: elementMap.size, postId: pagePostId, single: single, view: singleView(), mode: viewMode || 'page' });

		// Block all form submissions in discovery mode
		document.addEventListener('submit', function (e) {
			e.preventDefault();
		}, true);
	}

	/** A post's or a product's own page ('post', 'product'), null for any other page. */
	function singleView() {
		var b = document.body;
		if (!b) return null;
		if (b.classList.contains('single-product')) return 'product';
		if (b.classList.contains('single-post') || (b.classList.contains('single') && !b.classList.contains('attachment'))) return 'post';
		return null;
	}

	/**
	 * A post's own content: its title, its picture, its words, its date, its
	 * categories and tags (the marks of a designed post page, 2026-10-19), and
	 * what the editor alone shows of it (its summary).
	 */
	var POST_OWN = '[data-wm-field="title"], .entry-title, .wp-block-post-title, .wm-entry, .entry-content, .wp-block-post-content, .post-content, .wp-post-image, .post-thumbnail, .wp-block-post-featured-image, [data-wm-field="image"], [data-wm-field="content"], '
		+ '[data-wm-field="date"], [data-wm-field="categories"], [data-wm-field="tags"], [data-wme-added]';
	/**
	 * A product's own content: its name, its price, its descriptions, its
	 * pictures, its category; with a designed product page's marks
	 * (2026-10-19), its item number, sizes, spec line, options and reviews;
	 * and what the editor alone shows of it (an empty description).
	 */
	var PRODUCT_OWN = '.product_title, [data-wm="price"], .summary .price, .woocommerce-product-details__short-description, .woocommerce-Tabs-panel--description, #tab-description, .woocommerce-product-gallery, .product_meta .posted_in, [data-wm-field="name"], [data-wm-field="price"], [data-wm-field="description"], [data-wm-field="short_description"], [data-wm-field="image"], [data-wm-field="gallery"], [data-wm-field="category"], '
		+ '[data-wm-field="sku"], [data-wm-field="dimensions"], [data-wm-field="spec"], [data-wm-field="options"], [data-wm-field="reviews"], [data-wme-added]';
	/**
	 * The designed empty picture ("photograph to come"): in the product (or
	 * post) editor it is where the picture goes, so it is the record's; on the
	 * product page itself it is the design's.
	 */
	var EMPTY_PICTURE = '[data-wm-empty="image"]';

	/** A mark whose words hold a label and a value (" // ITEM <span>006</span>"): its value is its last element with words. */
	var VALUE_MARKS = '[data-wm-field="sku"], [data-wm-field="spec"], [data-wm-field="dimensions"]';

	/** The value a mark shows: itself, or its last element with words when it also holds a label. */
	function valueOf(mark) {
		var el = mark;
		for (;;) {
			var kids = el.children;
			var last = null;
			for (var i = kids.length - 1; i >= 0; i--) {
				if ((kids[i].textContent || '').trim()) { last = kids[i]; break; }
			}
			if (!last) return el;
			// Words beside the last element (the label) leave that element the value; else go down.
			var rest = (el.textContent || '').replace(last.textContent || '', '').trim();
			if (rest) return last;
			el = last;
		}
	}

	/** The post's or the product's own page: the element holding its content (its design's wrapper), or null. */
	function recordRoot(view) {
		return view === 'product'
			? document.querySelector('[data-wm-product-id], .product.type-product')
			: document.querySelector('[data-wm-post], article.type-post, article.post, main article');
	}

	/**
	 * The post's or the product's own content on its page, outermost first;
	 * null when the page shows none. forTemplate: as the product page itself
	 * sees it (the designed empty picture is the design's there).
	 */
	function ownContent(view, forTemplate) {
		var root = recordRoot(view);
		if (!root) return null;
		var own = view === 'product' ? PRODUCT_OWN : POST_OWN;
		var found = Array.prototype.slice.call(root.querySelectorAll(forTemplate ? own : own + ', ' + EMPTY_PICTURE)).filter(function (el) {
			// The design's gallery spot holding WooCommerce's gallery: the gallery is the part (its box is the pictures').
			return !(el.matches('[data-wm-field="gallery"]') && el.querySelector('.woocommerce-product-gallery'));
		}).map(function (el) {
			// A product's options: the design's buy row holds WooCommerce's whole cart form; only its pickers
			// are the product's, the quantity box and the button are the product page's (2026-10-19).
			if (el.matches('[data-wm-field="options"]')) return el.querySelector('table.variations, .variations') || el;
			return el.matches(VALUE_MARKS) ? valueOf(el) : el;
		});
		// The name, where the template prints it without a mark: the page's first heading.
		var title = root.querySelector('h1');
		if (title) found.unshift(title);
		var own2 = found.filter(function (el) {
			// Not a related product's card, nor a post listed inside the post.
			var card = el.parentElement ? el.parentElement.closest('[data-wm-product], [data-wm-post], li.product, .wc-block-grid__product') : null;
			return !card || card === root;
		});
		var roots = own2.filter(function (el, i) {
			if (own2.indexOf(el) !== i) return false;
			for (var j = 0; j < own2.length; j++) if (own2[j] !== el && own2[j].contains(el)) return false;
			return true;
		});
		return roots.length ? roots : null;
	}

	/** The part of the record a mark names, in the owner's words (the window's actions follow it). */
	var MARK_WORDS = {
		sku: 'Item number', dimensions: 'Sizes', spec: 'Spec line', options: 'Options', reviews: 'Reviews',
		date: 'Date', categories: 'Categories', tags: 'Tags',
	};
	/** What the editor alone shows, by its part. */
	var ADDED_WORDS = { summary: 'Summary', description: 'Description', short_description: 'Short description', categories: 'Categories', tags: 'Tags' };

	/** What an own-content part is called when nothing else names it. */
	function ownWord(el, view) {
		var added = el.getAttribute('data-wme-added');
		if (added && ADDED_WORDS[added]) return ADDED_WORDS[added];
		var mark = el.closest(VALUE_MARKS) || el;
		var field = mark.getAttribute('data-wm-field');
		if (field && MARK_WORDS[field]) return MARK_WORDS[field];
		if (view === 'product' && el.closest('[data-wm-field="options"]')) return 'Options';
		if (/^H[1-6]$/.test(el.tagName) || el.matches('.product_title, .entry-title, .wp-block-post-title, [data-wm-field="title"], [data-wm-field="name"]')) return 'Title';
		if (el.matches('[data-wm="price"], .price, [data-wm-field="price"]')) return 'Price';
		if (el.matches('.woocommerce-product-details__short-description, [data-wm-field="short_description"]')) return 'Short description';
		if (el.matches('.posted_in, [data-wm-field="category"]')) return 'Category';
		if (el.matches('img, .woocommerce-product-gallery, .post-thumbnail, .wp-block-post-featured-image, [data-wm-field="image"], [data-wm-field="gallery"], ' + EMPTY_PICTURE)) return view === 'product' ? 'Pictures' : 'Featured image';
		return view === 'product' ? 'Description' : 'Content';
	}

	/** The parts typed in place besides a title and words: a value the record holds as plain words. */
	var TYPED_PARTS = { 'Item number': 1, Sizes: 1, 'Spec line': 1, Date: 1, Summary: 1 };

	/** What the plugin tells the editor of the record shown (its summary, categories and tags; which texts it has), or {}. */
	function ownExtras(view) {
		var all = window.wmeOwn && typeof window.wmeOwn === 'object' ? window.wmeOwn : {};
		var mine = all[view];
		return mine && typeof mine === 'object' ? mine : {};
	}

	/** The lines named before their words ("Summary  ..."); an empty text's line says only what to add. */
	var LABELLED_LINES = { summary: 1, categories: 1, tags: 1 };

	/** One line only the editor shows, at its place (once); its words, or its placeholder when it has none. */
	function addLine(kind, tag, where, after, words, placeholder) {
		if (!where || !where.parentNode) return;
		var line = document.querySelector('[data-wme-added="' + kind + '"]');
		if (!line) {
			line = document.createElement(tag);
			line.setAttribute('data-wme-added', kind);
			if (LABELLED_LINES[kind]) line.setAttribute('data-wme-label', ADDED_WORDS[kind]);
			line.setAttribute('data-wme-placeholder', placeholder);
			line.textContent = words;
			where.parentNode.insertBefore(line, after ? where.nextSibling : where);
		}
	}

	/**
	 * What the post editor and the product editor show that visitors never
	 * see (2026-10-19): a post's summary under its title (its excerpt), its
	 * categories and tags when the design shows none; a product's empty
	 * description and short description where they would show. Each is the
	 * record's own part, changed like the others.
	 */
	function addOwnLines(view) {
		var root = recordRoot(view);
		var extras = ownExtras(view);
		if (!root) return;
		suppressObserver = true;
		// Only what the plugin said of this post (window.wmeOwn): no line stands for a value it did not read.
		if (view === 'post' && typeof extras.summary === 'string') {
			var title = root.querySelector('[data-wm-field="title"], .entry-title, .wp-block-post-title, h1');
			if (title) {
				addLine('summary', 'p', title, true, extras.summary, 'Add a summary');
				var names = function (list) {
					return Array.isArray(list) ? list.map(function (t) { return t && t.name ? String(t.name) : ''; }).filter(Boolean).join(', ') : '';
				};
				var summary = document.querySelector('[data-wme-added="summary"]');
				if (!root.querySelector('[data-wm-field="tags"]')) addLine('tags', 'p', summary, true, names(extras.tags), 'Add tags');
				if (!root.querySelector('[data-wm-field="categories"]')) addLine('categories', 'p', summary, true, names(extras.categories), 'Add categories');
			}
		} else if (view === 'product') {
			var name = root.querySelector('[data-wm-field="name"], .product_title, h1');
			if (extras.description === false && name && !root.querySelector('[data-wm-field="description"], .woocommerce-Tabs-panel--description, #tab-description')) {
				// Where its section would be: after the section that holds the name.
				var host = name.closest('[data-wm-section], section') || name.parentElement;
				addLine('description', 'div', host, true, '', 'Add a description');
			}
			if (extras.shortDescription === false && name && !root.querySelector('[data-wm-field="short_description"], .woocommerce-product-details__short-description')) {
				var price = root.querySelector('[data-wm-field="price"], [data-wm="price"], .summary .price');
				var below = price && price.parentElement && price.parentElement !== root ? price.parentElement : name;
				addLine('short_description', 'p', below, true, '', 'Add a short description');
			}
		}
		if (mutationObserver) mutationObserver.takeRecords();
		suppressObserver = false;
	}

	/** The editor's own lines gone (the product page itself, a page). */
	function removeOwnLines() {
		var lines = document.querySelectorAll('[data-wme-added]');
		if (!lines.length) return;
		suppressObserver = true;
		for (var i = 0; i < lines.length; i++) lines[i].parentNode.removeChild(lines[i]);
		if (mutationObserver) mutationObserver.takeRecords();
		suppressObserver = false;
	}

	/**
	 * A post's or a product's own page (2026-10-18): only its own content is a
	 * part (it is changed in the post or the product, never in the template:
	 * the product template is every product's). The rest (the header, the
	 * footer, the comments, related products, the template's own words and
	 * pictures) is changed elsewhere: it takes no outline and dims.
	 */
	function keepOwnContent() {
		var view = singleView();
		if (view) addOwnLines(view);
		else removeOwnLines();
		var roots = view ? ownContent(view) : null;
		if (!roots) { dimOnly(new Set(), null); return; }
		var rootOf = function (el) {
			for (var i = 0; i < roots.length; i++) if (roots[i] === el || roots[i].contains(el)) return roots[i];
			return null;
		};
		var words = function (entry) {
			return TEXT_CATEGORIES.indexOf(entry.category) !== -1 && entry.category !== 'text-meta';
		};
		elementMap.forEach(function (entry, uid) {
			var root = rootOf(entry.el);
			// A product's options are one part, its pickers together, never a WooCommerce field of their own (2026-10-19).
			if (!root || (root !== entry.el && view === 'product' && root.closest('[data-wm-field="options"]'))) {
				elementMap.delete(uid);
				elementLookup.delete(entry.el);
				return;
			}
			entry.single = view;
			// The part of the post or the product it is in (its words, its pictures, its price), for the window's actions.
			entry.ownPart = ownWord(root, view);
			// The title, the price, the pictures, the category: named for what they are to the post or the product,
			// over a name found for the element alone (a link, a card) (2026-10-19).
			if (root === entry.el) entry.word = entry.ownPart;
			// Typed in place: a post's title and words; a product's name and descriptions (its price has its own field);
			// a value the record keeps as plain words (an item number, a size, a date, a summary) (2026-10-19).
			entry.editable = root === entry.el && TYPED_PARTS[entry.ownPart]
				? true
				: view === 'post'
					? words(entry) && !/^(Categories|Tags)$/.test(entry.ownPart)
					: entry.word === 'Title' || ((entry.ownPart === 'Short description' || entry.ownPart === 'Description') && words(entry));
			ownDetails(entry, root);
		});
		for (var r = 0; r < roots.length; r++) {
			if (elementLookup.has(roots[r]) || roots[r].offsetHeight < 5 || unseen(roots[r])) continue;
			var word = ownWord(roots[r], view);
			var category = word === 'Title' ? 'text-heading'
				: word === 'Summary' ? 'text-paragraph'
					: word === 'Price' || word === 'Category' || TYPED_PARTS[word] || word === 'Categories' || word === 'Tags' ? 'text-meta'
						: /picture|image/i.test(word) ? 'image' : 'layout-group';
			var added = addEntry(roots[r], category, word === 'Title' || !!TYPED_PARTS[word], detectPagePostId(), word, '');
			added.single = view;
			added.ownPart = word;
			ownDetails(added, roots[r]);
		}
		// The rest dims: every element beside the way from the page down to the content.
		var way = new Set();
		var dim = new Set();
		roots.forEach(function (root) { for (var n = root; n && n !== document.body; n = n.parentElement) way.add(n); });
		way.forEach(function (n) {
			var parent = n.parentElement;
			if (!parent) return;
			for (var c = 0; c < parent.children.length; c++) {
				var sib = parent.children[c];
				if (way.has(sib) || /^(SCRIPT|STYLE|LINK|META|NOSCRIPT|TEMPLATE)$/.test(sib.tagName)) continue;
				dim.add(sib);
			}
		});
		dimOnly(dim, null);
	}

	/**
	 * Dims exactly these elements, touching only what changes (2026-10-19):
	 * taking every dim off and putting it back on each rebuild ran the dims'
	 * fade again, its end rebuilt the map, and the dimmed parts blinked
	 * without end. own: on the product page itself, the record's own parts
	 * by their name (data-wme-own, for the crossing note); null elsewhere.
	 */
	function dimOnly(dim, own) {
		var marked = document.querySelectorAll('[data-wme-dim], [data-wme-own]');
		for (var d = 0; d < marked.length; d++) {
			if (!dim.has(marked[d])) marked[d].removeAttribute('data-wme-dim');
			if (!own || !own.has(marked[d])) marked[d].removeAttribute('data-wme-own');
		}
		dim.forEach(function (el) { if (!el.hasAttribute('data-wme-dim')) el.setAttribute('data-wme-dim', ''); });
		if (own) {
			own.forEach(function (word, el) { if (el.getAttribute('data-wme-own') !== word) el.setAttribute('data-wme-own', word); });
		}
	}

	/** What the window needs of an own part beyond its name: which size it is, and an empty one (the editor's own line, the designed empty picture). */
	function ownDetails(entry, root) {
		var mark = root.closest('[data-wm-dimension]');
		if (mark) entry.dimension = mark.getAttribute('data-wm-dimension');
		if (root.matches(EMPTY_PICTURE) || (root.hasAttribute('data-wme-added') && !(root.textContent || '').trim())) entry.empty = true;
	}

	/**
	 * The product page or the post page itself (2026-10-19), the inverse of
	 * keepOwnContent: the record shown is an example, so its own parts (its
	 * name, price, pictures, words...) dim and are no parts; everything the
	 * design prints for every product (or post) is: its sections and their
	 * parts, the picture's frame, the designed empty picture. A part holding
	 * the record's content (the picture's frame) says so (holdsOwn), for the
	 * window's "Edit this product".
	 */
	function keepTemplate() {
		removeOwnLines();
		var view = singleView();
		var roots = view ? ownContent(view, true) : null;
		if (!roots) { dimOnly(new Set(), null); return; }
		var inRoot = function (el) {
			for (var i = 0; i < roots.length; i++) if (roots[i] === el || roots[i].contains(el)) return true;
			return false;
		};
		elementMap.forEach(function (entry, uid) {
			if (!inRoot(entry.el)) return;
			elementMap.delete(uid);
			elementLookup.delete(entry.el);
		});
		// The record's own parts dim, by difference (never cleared and dimmed again: their fade would rebuild the map).
		var own = new Map();
		for (var r = 0; r < roots.length; r++) own.set(roots[r], ownWord(roots[r], view));
		dimOnly(new Set(roots), own);
		var record = recordRoot(view);
		elementMap.forEach(function (entry) {
			var el = entry.el;
			// A part of a section (or of the record's wrapper on a page without sections), never a section or the page itself.
			var part = el.parentElement && (el.parentElement.closest('[data-wm-section]')
				|| (record && record !== el && record.contains(el) && !el.querySelector('[data-wm-section]')));
			if (!part || inChrome(el)) return;
			var holds = el.matches(EMPTY_PICTURE) || !!el.querySelector(EMPTY_PICTURE);
			for (var i = 0; i < roots.length && !holds; i++) if (el.contains(roots[i])) holds = true;
			if (holds) entry.holdsOwn = true;
		});
	}

	/** What a section's template prints beyond the page shown: every product page, every post page, the shop and its category pages, the blog's list. */
	var TEMPLATE_REACH = {
		'woocommerce/single-product.php': 'product', 'single.php': 'post',
		'woocommerce/archive-product.php': 'shop', 'woocommerce/taxonomy-product_cat.php': 'shop', 'home.php': 'blog',
	};

	/** The header or the footer of the page an element sits in, if any. */
	function inChrome(el) {
		if (el.closest('[data-wm-chrome]')) return true;
		var hf = el.closest('header, footer');
		return !!hf && !hf.closest('main, article, [data-wm-section]');
	}

	/**
	 * What a part prints on beyond this page (the Template tag, 2026-10-19):
	 * on the product page or the post page itself, every product (or post)
	 * page; anywhere, a section of the shop's or the blog list's template,
	 * which prints on its category pages too. '' for a part of this page only.
	 */
	function reachOf(el) {
		if (inChrome(el)) return '';
		var host = el.closest('[data-wm-template]');
		var reach = host ? TEMPLATE_REACH[host.getAttribute('data-wm-template')] || '' : '';
		if (reach === 'shop' || reach === 'blog') return reach;
		return viewMode === 'template' ? singleView() || '' : '';
	}

	/** A category a part shows (data-wm-term="product_cat:16"): its own name, its own description, or the category itself (a filter chip). */
	function termOf(el) {
		var m = /^(product_cat|category):(\d+)$/.exec(el.getAttribute('data-wm-term') || '');
		if (!m) return null;
		var field = el.getAttribute('data-wm-field');
		return { taxonomy: m[1], id: parseInt(m[2], 10), field: field === 'term_name' ? 'name' : field === 'term_description' ? 'description' : field === 'category' ? 'category' : 'chip' };
	}

	/** Each part's reach and category (after the map is built). */
	function markShared() {
		elementMap.forEach(function (entry) {
			entry.reach = reachOf(entry.el);
			var term = entry.single ? null : termOf(entry.el);
			if (!term) return;
			entry.term = term;
			// The category's own words: changed as the category (Rename, Change description), never typed into the design.
			entry.editable = false;
			if (term.field === 'name') entry.word = 'Category name';
			else if (term.field === 'description') entry.word = 'Category description';
			else entry.word = 'Category';
		});
	}

	/**
	 * Where a click on a dimmed part crosses to the other editor (2026-10-19):
	 * on the product page itself, a product's own part ("The Stoneware Jug's
	 * own picture", Edit this product); in the product editor, a part of the
	 * product page every product shares (Edit the product page). Null for
	 * anything else (a dimmed header is the page's, not the template's).
	 */
	function crossingAt(node) {
		var el = node && node.nodeType === 1 ? node : (node ? node.parentElement : null);
		if (!el || !el.closest) return null;
		var view = singleView();
		if (!view) return null;
		if (viewMode === 'template') {
			var own = el.closest('[data-wme-own]');
			return own ? { to: 'record', view: view, word: own.getAttribute('data-wme-own') || '' } : null;
		}
		if (!el.closest('[data-wme-dim]') || inChrome(el)) return null;
		var host = el.closest('[data-wm-template]');
		var reach = host ? TEMPLATE_REACH[host.getAttribute('data-wm-template')] || '' : '';
		var root = recordRoot(view);
		return reach === view || (!host && root && root.contains(el)) ? { to: 'template', view: view, word: '' } : null;
	}

	/**
	 * The part to select for a node once the other editor mapped the page: the
	 * part holding it, else the part it holds (a picture's frame holds the
	 * pictures), a picture first.
	 */
	function entryFor(node) {
		if (!node || !node.isConnected) return null;
		var held = findMappedElement(node);
		if (held) return held;
		var inside = [];
		elementMap.forEach(function (entry) { if (node.contains(entry.el)) inside.push(entry); });
		var outer = inside.filter(function (a) {
			for (var i = 0; i < inside.length; i++) if (inside[i] !== a && inside[i].el.contains(a.el)) return false;
			return true;
		});
		outer.sort(function (a, b) { return a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1; });
		for (var j = 0; j < outer.length; j++) if (outer[j].ownPart === 'Pictures' || outer[j].ownPart === 'Featured image') return outer[j];
		return outer[0] || null;
	}

	/** One more part in the map (a part found by what it is, not by a block). */
	function addEntry(el, category, editable, postId, word, kind) {
		var id = generateFallbackId(el);
		el.setAttribute('data-wme-fallback-id', id);
		var entry = {
			el: el,
			source: 'semantic',
			blockName: '',
			blockUid: id,
			postId: postId,
			category: category,
			editable: editable,
			rect: getElementRect(el),
		};
		if (word) entry.word = word;
		if (kind) entry.kind = kind;
		elementMap.set(id, entry);
		elementLookup.set(el, entry);
		return entry;
	}

	/** A form's fields. */
	var FIELDS = 'input:not([type="hidden"]), select, textarea';

	/** A field's name by its type, in the owner's words (what it asks for, not the HTML). */
	var FIELD_WORDS = {
		email: 'Email box', tel: 'Phone box', url: 'Web address box', password: 'Password box', number: 'Number box',
		search: 'Search box', date: 'Date picker', 'datetime-local': 'Date and time picker', month: 'Month picker',
		week: 'Week picker', time: 'Time picker', color: 'Color picker', file: 'File upload', checkbox: 'Checkbox',
		radio: 'Choice', range: 'Slider',
	};

	/** What a field is, in the owner's words: a search box, an email box, a dropdown... (2026-10-18). */
	function fieldWord(el) {
		if (el.tagName === 'SELECT') return el.multiple ? 'Choice list' : 'Dropdown';
		if (el.tagName === 'TEXTAREA') return 'Long text box';
		var type = (el.getAttribute('type') || 'text').toLowerCase();
		if (FIELD_WORDS[type]) return FIELD_WORDS[type];
		return isSearchField(el) ? 'Search box' : 'Text box';
	}

	/** A form that searches (WordPress's, the store's, one marked as a search). */
	function isSearchForm(el) {
		return el.matches('[role="search"], search, .search-form, .wp-block-search, .woocommerce-product-search') || !!el.querySelector('input[name="s"], input[type="search"]');
	}

	/** A text field that searches: marked as one, WordPress's search (s), or in a search form. */
	function isSearchField(el) {
		if (el.getAttribute('role') === 'searchbox' || el.getAttribute('name') === 's') return true;
		return !!el.closest('[role="search"], search, .search-form, .wp-block-search, .woocommerce-product-search');
	}

	/** A form's fields and their labels, each a part of its own (a submit input is a button). */
	function mapFields(postId) {
		var fields = document.querySelectorAll(FIELDS);
		for (var i = 0; i < fields.length; i++) {
			var field = fields[i];
			if (elementLookup.has(field) || insideAnnotatedBlock(field)) continue;
			if (field.offsetHeight < 5 && field.offsetWidth < 5) continue;
			var type = (field.getAttribute('type') || '').toLowerCase();
			if (type === 'submit' || type === 'button' || type === 'reset') {
				addEntry(field, 'text-button', false, postId, 'Button', '');
				continue;
			}
			addEntry(field, 'interactive', false, postId, fieldWord(field), 'field');
		}
		var labels = document.querySelectorAll('label');
		for (var j = 0; j < labels.length; j++) {
			var label = labels[j];
			if (elementLookup.has(label) || insideAnnotatedBlock(label) || label.offsetHeight < 5) continue;
			if (!(label.textContent || '').trim()) continue;
			// A label wrapping its field (a checkbox's): the field's line, its words its own.
			addEntry(label, 'text-label', false, postId, 'Label', '');
		}
	}

	/**
	 * A WordPress menu's links: the menu is the part (its items are the
	 * menu's own, changed with it), so a link in one selects the menu.
	 */
	var MENU_MARKS = '[data-wm-menu], [data-wm-menu-item], .menu-item, .page_item, .wp-block-navigation, .wp-block-page-list';

	/** What a link may hold and still have its words edited in place. */
	var INLINE_TAGS = /^(SPAN|EM|STRONG|B|I|U|SMALL|MARK|CODE|ABBR|SUP|SUB|BR|S)$/;

	/**
	 * Each link outside a WordPress menu, a part of its own (2026-10-18): a
	 * link in a sentence, a card's or a footer column's, a "Get directions".
	 * A link the size of the one thing it wraps (a logo's) leaves that thing
	 * the part. Its words are edited in place when it holds only words, and
	 * never on a live card (the store's or the blog's words) or around a
	 * value the site fills in (the cart's count).
	 */
	function mapLinks(postId) {
		var links = document.querySelectorAll('a[href]');
		for (var i = 0; i < links.length; i++) {
			var link = links[i];
			if (elementLookup.has(link) || link.closest(MENU_MARKS)) continue;
			var r = link.getBoundingClientRect();
			if (r.width < 5 || r.height < 5) continue;
			if (window.getComputedStyle(link).visibility === 'hidden') continue;
			var kids = link.children;
			if (kids.length === 1 && sameBox(r, kids[0].getBoundingClientRect())) continue;
			var wordsOnly = !!(link.textContent || '').trim();
			for (var k = 0; k < kids.length && wordsOnly; k++) {
				if (!INLINE_TAGS.test(kids[k].tagName)) wordsOnly = false;
			}
			var live = link.closest(LIVE_CARDS) || link.matches('[data-wm], [data-wm-field]') || link.querySelector('[data-wm], [data-wm-field]');
			addEntry(link, 'text-link', wordsOnly && !live, postId, 'Link', '');
		}
	}

	/** An embed (a map, a video, a widget from another service), a part of its own. */
	var EMBEDS = 'iframe, embed, object';

	function mapEmbeds(postId) {
		var embeds = document.querySelectorAll(EMBEDS);
		for (var i = 0; i < embeds.length; i++) {
			var embed = embeds[i];
			if (elementLookup.has(embed) || insideAnnotatedBlock(embed)) continue;
			if (embed.offsetHeight < 5 || embed.offsetWidth < 5) continue;
			addEntry(embed, 'embed', false, postId, 'Embed', 'embed');
		}
	}

	/**
	 * The page as the editor shows it (2026-10-18): one cursor everywhere,
	 * whatever a link, a button or a field would show on the site (the text
	 * caret only in the words being edited in place); and embeds take no
	 * pointer, since a frame inside the page keeps its own mouse and the page
	 * never heard it (no outline, no selection, the map moved instead). The
	 * embed is found under the pointer by embedAt.
	 */
	function holdPage() {
		if (document.getElementById('wme-hold-page')) return;
		var style = document.createElement('style');
		style.id = 'wme-hold-page';
		style.textContent = '*, *::before, *::after { cursor: default !important; }\n'
			+ '[contenteditable="true"], [contenteditable="true"] * { cursor: text !important; }\n'
			+ 'iframe, embed, object { pointer-events: none !important; }\n'
			+ '[data-wme-dim] { opacity: .4 !important; filter: grayscale(.5) !important; transition: opacity .2s; }\n'
			// The lines only the editor shows (a post's summary, a product's empty description): plainly the editor's, never the design's.
			+ '[data-wme-added] { display: block !important; box-sizing: border-box; margin: 10px 0; padding: 8px 12px; border: 1px dashed rgba(124, 92, 255, .6); border-radius: 8px;'
			+ ' background: rgba(124, 92, 255, .07); color: #4b3fa8; font: 500 13px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; letter-spacing: 0; text-transform: none; text-align: left; min-height: 0; }\n'
			+ '[data-wme-added][data-wme-label]::before { content: attr(data-wme-label) "  "; font-weight: 700; white-space: pre; }\n'
			+ '[data-wme-added]:empty::after { content: attr(data-wme-placeholder); opacity: .75; }\n'
			+ '[data-wme-added="description"] { margin: 24px auto; max-width: 960px; padding: 24px; text-align: center; }';
		(document.head || document.documentElement).appendChild(style);
	}

	/** The embed under the pointer inside the element the event reached (embeds take no pointer). */
	function embedAt(target, x, y) {
		if (!target || !target.querySelectorAll) return null;
		var embeds = target.querySelectorAll(EMBEDS);
		for (var i = 0; i < embeds.length; i++) {
			var r = embeds[i].getBoundingClientRect();
			if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return embeds[i];
		}
		return null;
	}

	/**
	 * The part under the pointer: the nearest one holding what is on top
	 * (an embed's own), or a part a decoration covers (an overlay, a line
	 * drawn over a picture) inside that one.
	 */
	/**
	 * The editor window's changes on this page (2026-10-19): the parts it follows (their boxes go with the
	 * positions) and the parts WPMaven is working on. A part is named by the editor's id: an element of the
	 * map, or a section of the bindings ("binding:<uid>", the window's Whole Section).
	 */
	var busyUids = [];
	var followUids = [];
	function partEl(uid) {
		uid = String(uid || '');
		if (uid.indexOf('binding:') === 0) {
			var bd = bindingByUid(uid.slice(8));
			return bd && bd.el.isConnected ? bd.el : null;
		}
		var en = elementMap.get(uid);
		return en ? en.el : null;
	}
	/** The busy part a part is (or sits in): a click there opens that change's window, never a part about to be rewritten. */
	function heldBy(entry) {
		for (var b = 0; entry && b < busyUids.length; b++) {
			var bel = partEl(busyUids[b]);
			if (bel && (bel === entry.el || bel.contains(entry.el))) return busyUids[b];
		}
		return null;
	}

	function partAt(e) {
		var faded = new Map();
		var top = embedAt(e.target, e.clientX, e.clientY) || e.target;
		var stack = document.elementsFromPoint && typeof e.clientX === 'number' ? document.elementsFromPoint(e.clientX, e.clientY) : [];
		// What the visitor cannot see on top (a zoom copy, a faded layer): the pointer goes through to what is under it.
		if (unseen(top, faded)) {
			top = null;
			for (var s = 0; s < stack.length; s++) {
				if (!unseen(stack[s], faded)) { top = stack[s]; break; }
			}
			if (!top) return null;
		}
		var entry = seenEntry(top, faded);
		if (!stack.length || !top.contains) return entry;
		for (var i = 0; i < stack.length; i++) {
			var el = stack[i];
			if (el === top || el.contains(top) || top.contains(el)) continue;
			var under = seenEntry(el, faded);
			if (under && under !== entry && (!entry || entry.el.contains(under.el))) return under;
		}
		return entry;
	}

	/** The nearest part holding a node, passing over a part that faded out since the map was built. */
	function seenEntry(node, faded) {
		var entry = findMappedElement(node);
		while (entry && unseen(entry.el, faded)) entry = entry.el.parentElement ? findMappedElement(entry.el.parentElement) : null;
		return entry;
	}

	/**
	 * What the visitor cannot see is never a part, and the pointer goes
	 * through it (2026-10-19): a faded element (opacity 0, its own or a
	 * parent's), a hidden one, WooCommerce's zoom copy of a picture (laid
	 * over it at full size, 1200 by 896 over a picture shown at 560 by 418)
	 * and PhotoSwipe's viewer.
	 */
	var UNSEEN = '.zoomImg, .pswp, .pswp *';

	/** Whether an element cannot be seen now; faded keeps each parent's answer for one pass over the page. */
	function unseen(el, faded) {
		if (!el || el.nodeType !== 1) return false;
		if (el.matches(UNSEEN)) return true;
		if (window.getComputedStyle(el).visibility === 'hidden') return true;
		return fadedOut(el, faded || new Map());
	}

	/** Whether an element or one of its parents is at opacity 0. */
	function fadedOut(el, faded) {
		var walked = [];
		var answer = false;
		for (var n = el; n && n.nodeType === 1 && n !== document.documentElement; n = n.parentElement) {
			if (faded.has(n)) { answer = faded.get(n); break; }
			walked.push(n);
			if (Number(window.getComputedStyle(n).opacity) === 0) { answer = true; break; }
		}
		for (var i = 0; i < walked.length; i++) faded.set(walked[i], answer);
		return answer;
	}

	/** The parts left out of the last map because they could not be seen (onShown maps them once they show). */
	var unseenParts = [];

	function dropUnseen() {
		var faded = new Map();
		unseenParts = [];
		elementMap.forEach(function (entry, uid) {
			if (!unseen(entry.el, faded)) return;
			unseenParts.push(entry.el);
			elementMap.delete(uid);
			elementLookup.delete(entry.el);
		});
	}

	/**
	 * WooCommerce's gallery (2026-10-19): one part, "Pictures", with the box
	 * of the gallery itself (the picture shown and its thumbnails), never its
	 * slider's track (as wide as every picture together) or a picture inside
	 * it. Each thumbnail is a picture of its own, by its place in the gallery
	 * (0 is the product's main picture).
	 */
	var GALLERY = '.woocommerce-product-gallery';
	var GALLERY_THUMBS = '.flex-control-thumbs img, .flex-control-nav img';

	function mapGalleries(postId) {
		var galleries = document.querySelectorAll(GALLERY);
		for (var g = 0; g < galleries.length; g++) {
			var gallery = galleries[g];
			elementMap.forEach(function (entry, uid) {
				if (entry.el === gallery || !gallery.contains(entry.el)) return;
				elementMap.delete(uid);
				elementLookup.delete(entry.el);
			});
			var own = elementLookup.get(gallery) || (gallery.offsetHeight >= 5 ? addEntry(gallery, 'gallery', false, postId, '', '') : null);
			if (!own) continue;
			own.word = 'Pictures';
			var thumbs = gallery.querySelectorAll(GALLERY_THUMBS);
			for (var t = 0; t < thumbs.length; t++) {
				if (thumbs[t].offsetHeight < 5) continue;
				addEntry(thumbs[t], 'image', false, postId, 'Picture', '').picture = t;
			}
		}
	}

	/** The tags a section's own parts are drawn with (a card, a grid, a row, a group). */
	var PART_TAGS = 'div, li, aside, fieldset, details, dl';
	var PART_MEDIA = 'img, svg, video, iframe, picture, canvas, input, select, textarea, button';

	/** Each designed section's own parts (and the header's and footer's): its cards, grids, rows and groups. */
	function mapSectionParts(postId) {
		var hosts = document.querySelectorAll('[data-wm-section], [data-wm-chrome]');
		for (var h = 0; h < hosts.length; h++) {
			var boxes = hosts[h].querySelectorAll(PART_TAGS);
			for (var i = 0; i < boxes.length; i++) {
				var box = boxes[i];
				if (elementLookup.has(box) || box.matches(LIVE_CARDS) || insideAnnotatedBlock(box)) continue;
				var part = partOf(box);
				if (part) addEntry(box, part.category, false, postId, part.word, part.kind);
			}
		}
	}

	/**
	 * What a box of a section is, null when it is not a part to point at: a
	 * wrapper the size of its one child or of the part around it, an empty or
	 * hidden box, a box holding a single thing it does not draw around.
	 */
	function partOf(box) {
		var kids = 0;
		var only = null;
		for (var k = 0; k < box.children.length; k++) {
			if (/^(SCRIPT|STYLE|TEMPLATE|BR|LINK|META)$/.test(box.children[k].tagName)) continue;
			kids++;
			only = box.children[k];
		}
		if (!kids) return null;
		var r = box.getBoundingClientRect();
		if (r.width < 8 || r.height < 8) return null;
		var cs = window.getComputedStyle(box);
		if (cs.visibility === 'hidden' || cs.display === 'contents' || Number(cs.opacity) === 0) return null;
		var drawn = drawsBox(cs);
		if (kids < 2 && !drawn) return null;
		if (!(box.textContent || '').trim() && !box.querySelector(PART_MEDIA)) return null;
		if (kids === 1 && sameBox(r, only.getBoundingClientRect())) return null;
		var around = box.parentElement ? findMappedElement(box.parentElement) : null;
		if (around && sameBox(r, around.el.getBoundingClientRect())) return null;
		// A field's line: its label and its one field.
		if (box.querySelectorAll(FIELDS).length === 1 && box.querySelector('label') && !box.querySelector('form')) {
			return { category: 'interactive', word: 'Field', kind: 'field' };
		}
		if (drawn) return { category: 'layout-group', word: 'Card', kind: 'group' };
		if (kids >= 2 && cs.display.indexOf('grid') !== -1) return { category: 'layout-group', word: 'Grid', kind: 'group' };
		if (kids >= 2 && cs.display.indexOf('flex') !== -1 && cs.flexDirection.indexOf('row') === 0) return { category: 'layout-group', word: 'Row', kind: 'group' };
		return { category: 'layout-group', word: 'Group', kind: 'group' };
	}

	/** Whether a box draws itself: a background, a shadow, or a border on two sides or more (not a single rule). */
	function drawsBox(cs) {
		if (cs.backgroundImage && cs.backgroundImage !== 'none') return true;
		if (cs.boxShadow && cs.boxShadow !== 'none') return true;
		if (shows(cs.backgroundColor)) return true;
		var sides = ['Top', 'Right', 'Bottom', 'Left'];
		var n = 0;
		for (var i = 0; i < sides.length; i++) {
			if (parseFloat(cs['border' + sides[i] + 'Width']) > 0 && cs['border' + sides[i] + 'Style'] !== 'none' && shows(cs['border' + sides[i] + 'Color'])) n++;
		}
		return n >= 2;
	}

	/** A computed colour that shows (not transparent). */
	function shows(color) {
		if (!color || color === 'transparent') return false;
		var m = /rgba?\(([^)]*)\)/.exec(color);
		if (!m) return true;
		var parts = m[1].split(/[\s,\/]+/).filter(Boolean);
		return parts.length < 4 || parseFloat(parts[3]) > 0;
	}

	/** Two boxes within 2px of each other on every side. */
	function sameBox(a, b) {
		return Math.abs(a.top - b.top) <= 2 && Math.abs(a.left - b.left) <= 2 && Math.abs(a.right - b.right) <= 2 && Math.abs(a.bottom - b.bottom) <= 2;
	}

	/** The words a part is known by: its text, or a field's label (else its placeholder or name), or an embed's title. */
	function wordsOf(el) {
		if (/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) {
			var label = el.labels && el.labels[0] ? el.labels[0] : (el.parentElement ? el.parentElement.querySelector('label') : null);
			var said = (label && label.textContent) || el.getAttribute('placeholder') || el.getAttribute('aria-label') || el.getAttribute('name') || '';
			return said.replace(/\s+/g, ' ').trim().substring(0, 500);
		}
		if (/^(IFRAME|EMBED|OBJECT)$/.test(el.tagName)) return (el.getAttribute('title') || el.getAttribute('aria-label') || '').substring(0, 500);
		var text = (el.textContent || '').substring(0, 500);
		if (text.trim()) return text;
		// A part with no words (a card holding a picture): its picture's.
		var img = el.querySelector ? el.querySelector('img[alt]:not([alt=""])') : null;
		return img ? img.getAttribute('alt').substring(0, 500) : (el.getAttribute('aria-label') || '');
	}

	/** An element holding a designed page's sections without being one: the page, never a part of it. */
	function wrapsSections(el) {
		return !el.hasAttribute('data-wm-section') && !!el.querySelector('[data-wm-section]');
	}

	/** A card showing a live item: a product from the store, a post. */
	var LIVE_CARDS = '[data-wm-product], [data-wm-post], li.product, .wc-block-grid__product, .wc-block-product';

	/** A form: a designed one, or a form plugin's. */
	var FORM_MARKS = '[data-wm-form], .wpforms-container, .wpcf7, .gform_wrapper, .frm_forms, .fluentform, .nf-form-cont, .mc4wp-form';
	/** Any form, a part of its own: the marked ones, and a plain one (a search form, a store's). */
	var ANY_FORM = FORM_MARKS + ', form';

	/** How many of an element's own children are live cards. */
	function liveCardsIn(el) {
		var n = 0;
		for (var i = 0; i < el.children.length; i++) {
			if (el.children[i].matches(LIVE_CARDS)) n++;
		}
		return n;
	}

	/** Inside a block the server annotated (never a designed section, whose words are mapped). */
	function insideAnnotatedBlock(el) {
		var host = el.closest('[data-wme-source]');
		while (host && host.getAttribute('data-wme-designed') === 'true') {
			host = host.parentElement ? host.parentElement.closest('[data-wme-source]') : null;
		}
		return !!host;
	}

	/**
	 * Find un-mapped content elements inside layout containers and create
	 * virtual entries so they're individually selectable.
	 */
	function discoverInnerContentElements() {
		var layouts = document.querySelectorAll(
			'[data-wme-category^="layout"], [data-wme-category="navigation"]'
		);
		for (var i = 0; i < layouts.length; i++) {
			var container = layouts[i];
			var postId = container.getAttribute('data-wme-post-id') || '';
			var containerSource = container.getAttribute('data-wme-source') || 'block';

			// Find un-mapped <img> elements (background images, decorative images).
			var imgs = container.querySelectorAll('img');
			for (var m = 0; m < imgs.length; m++) {
				var img = imgs[m];
				if (elementLookup.has(img)) continue;
				// Skip if inside an already-mapped image or gallery block.
				if (img.closest('[data-wme-category="image"], [data-wme-category="gallery"]')) continue;
				if (img.offsetHeight < 5 || img.offsetWidth < 5) continue;

				var imgUid = 'virtual_img_' + i + '_' + m;
				img.setAttribute('data-wme-fallback-id', imgUid);
				img.setAttribute('data-wme-category', 'image');
				var imgEntry = {
					el: img,
					source: containerSource,
					blockName: 'background-image',
					blockUid: imgUid,
					postId: postId,
					category: 'image',
					editable: true,
					rect: toPlainRect(img.getBoundingClientRect()),
				};
				elementMap.set(imgUid, imgEntry);
				elementLookup.set(img, imgEntry);
			}

			// Find un-mapped <video> elements.
			var videos = container.querySelectorAll('video');
			for (var v = 0; v < videos.length; v++) {
				var vid = videos[v];
				if (elementLookup.has(vid)) continue;
				if (vid.closest('[data-wme-category="video"], [data-wme-category="media"]')) continue;
				if (vid.offsetHeight < 5) continue;

				var vidUid = 'virtual_vid_' + i + '_' + v;
				vid.setAttribute('data-wme-fallback-id', vidUid);
				vid.setAttribute('data-wme-category', 'video');
				var vidEntry = {
					el: vid,
					source: containerSource,
					blockName: 'background-video',
					blockUid: vidUid,
					postId: postId,
					category: 'video',
					editable: false,
					rect: toPlainRect(vid.getBoundingClientRect()),
				};
				elementMap.set(vidUid, vidEntry);
				elementLookup.set(vid, vidEntry);
			}
		}
	}

	function generateFallbackId(el) {
		var path = [];
		var current = el;
		while (current && current !== document.body) {
			var parent = current.parentElement;
			if (parent) {
				var children = parent.children;
				for (var i = 0; i < children.length; i++) {
					if (children[i] === current) { path.unshift(i); break; }
				}
			}
			current = parent;
		}
		return 'sem_' + path.join('.');
	}

	function categorizeSemanticElement(tag) {
		if (/^h[1-6]$/.test(tag)) return 'text-heading';
		if (tag === 'p') return 'text-paragraph';
		if (tag === 'img') return 'image';
		if (tag === 'nav') return 'navigation';
		if (tag === 'button') return 'text-button';
		return 'layout-section';
	}

	// ── Third-Party Builder Detection ──────────────────────────────────

	/**
	 * Detect Elementor widgets that weren't annotated by the PHP adapter
	 * (e.g., when Elementor renders client-side or via AJAX).
	 */
	function detectElementorWidgets() {
		// The page's post id, as buildElementMap reads it (each detector runs on its own).
		var pagePostId = detectPagePostId();
		var widgets = document.querySelectorAll('[data-id][data-element_type="widget"]');
		for (var i = 0; i < widgets.length; i++) {
			var el = widgets[i];
			// Skip if already discovered via PHP adapter or block annotations.
			if (el.closest('[data-wme-source]')) continue;
			if (el.offsetHeight < 5) continue;

			var widgetId = el.getAttribute('data-id') || '';
			var widgetType = el.getAttribute('data-widget_type') || '';
			// data-widget_type is like "heading.default"
			widgetType = widgetType.split('.')[0];

			var uid = 'elem_' + widgetId;
			el.setAttribute('data-wme-fallback-id', uid);

			var entry = {
				el: el,
				source: 'elementor',
				blockName: '',
				blockUid: uid,
				postId: pagePostId,
				category: categorizeElementorWidget(widgetType),
				editable: isEditableElementorWidget(widgetType),
				rect: getElementRect(el),
			};
			elementMap.set(uid, entry);
			elementLookup.set(el, entry);
		}
	}

	function categorizeElementorWidget(type) {
		var map = {
			// Text content.
			'heading': 'text-heading', 'text-editor': 'text-paragraph',
			'button': 'text-button', 'icon-box': 'text-paragraph',
			'alert': 'text-paragraph', 'html': 'text-code',
			'blockquote': 'text-quote', 'testimonial': 'text-quote',
			'animated-headline': 'text-heading', 'text-path': 'text-heading',
			'highlighted-text': 'text-heading', 'flip-box': 'text-paragraph',
			'code-highlight': 'text-code',
			// Lists & structured.
			'icon-list': 'text-list', 'price-list': 'text-list',
			'price-table': 'text-list',
			// Meta / counters.
			'counter': 'text-meta', 'progress': 'text-meta',
			'star-rating': 'text-meta',
			// Images.
			'image': 'image', 'image-box': 'image',
			// Gallery.
			'image-gallery': 'gallery', 'image-carousel': 'gallery',
			'media-carousel': 'gallery', 'slides': 'gallery',
			'portfolio': 'gallery',
			// Video.
			'video': 'video', 'video-playlist': 'video',
			// Audio.
			'audio': 'audio', 'soundcloud': 'audio',
			// Media.
			'lottie': 'media',
			// Embeds.
			'google-maps': 'embed',
			// Accordion / Tabs.
			'accordion': 'accordion', 'toggle': 'accordion', 'tabs': 'accordion',
			// Navigation.
			'nav-menu': 'navigation', 'breadcrumbs': 'navigation',
			'sitemap': 'navigation', 'mega-menu': 'navigation',
			'table-of-contents': 'navigation',
			// Social.
			'social-icons': 'social', 'share-buttons': 'social',
			// Interactive / Forms.
			'form': 'interactive', 'login': 'interactive',
			'search-form': 'interactive', 'wp-widget-form': 'interactive',
			'call-to-action': 'text-button',
			// Posts / Archives.
			'posts': 'text-list', 'archive-posts': 'text-list',
			'loop-grid': 'text-list', 'reviews': 'text-quote',
			// Layout.
			'divider': 'layout-section', 'spacer': 'layout-section',
			'section': 'layout-section', 'container': 'layout-section',
			// WooCommerce.
			'woocommerce-product-images': 'image',
			'wc-add-to-cart': 'text-button', 'wc-categories': 'text-list',
			'wc-products': 'text-list',
		};
		return map[type] || 'unknown';
	}

	function isEditableElementorWidget(type) {
		return ['heading', 'text-editor', 'button', 'image', 'testimonial',
				'icon-box', 'call-to-action', 'alert', 'blockquote',
				'animated-headline', 'highlighted-text', 'flip-box',
				'accordion', 'toggle', 'tabs', 'counter', 'price-table',
				'price-list', 'star-rating', 'text-path', 'code-highlight'].indexOf(type) !== -1;
	}

	/**
	 * Detect Divi modules that weren't annotated by the PHP adapter.
	 */
	function detectDiviModules() {
		// The page's post id, as buildElementMap reads it (each detector runs on its own).
		var pagePostId = detectPagePostId();
		// Divi modules have class starting with et_pb_ and an _module suffix or specific types.
		var diviModules = document.querySelectorAll(
			'.et_pb_text, .et_pb_blurb, .et_pb_image, .et_pb_button, ' +
			'.et_pb_heading, .et_pb_cta, .et_pb_testimonial, .et_pb_slider, ' +
			'.et_pb_gallery, .et_pb_video, .et_pb_audio, .et_pb_code, ' +
			'.et_pb_accordion, .et_pb_toggle, .et_pb_tabs, .et_pb_menu, ' +
			'.et_pb_blog, .et_pb_portfolio, .et_pb_filterable_portfolio, ' +
			'.et_pb_shop, .et_pb_contact_form, .et_pb_signup, .et_pb_search, ' +
			'.et_pb_social_media_follow, .et_pb_comments, .et_pb_sidebar, ' +
			'.et_pb_divider, .et_pb_login, .et_pb_fullwidth_header, ' +
			'.et_pb_circle_counter, .et_pb_number_counter, .et_pb_countdown_timer, ' +
			'.et_pb_bar_counters, .et_pb_pricing_tables, .et_pb_map, ' +
			'.et_pb_team_member, .et_pb_person, .et_pb_video_slider'
		);
		for (var i = 0; i < diviModules.length; i++) {
			var el = diviModules[i];
			if (el.closest('[data-wme-source]')) continue;
			if (el.offsetHeight < 5) continue;

			var moduleType = extractDiviModuleType(el.className);
			if (!moduleType) continue;

			var uid = 'divi_' + moduleType + '_' + i;
			el.setAttribute('data-wme-fallback-id', uid);

			var entry = {
				el: el,
				source: 'divi',
				blockName: '',
				blockUid: uid,
				postId: pagePostId,
				category: categorizeDiviModule(moduleType),
				editable: isEditableDiviModule(moduleType),
				rect: getElementRect(el),
			};
			elementMap.set(uid, entry);
			elementLookup.set(el, entry);
		}
	}

	function extractDiviModuleType(classes) {
		var match = classes.match(/\bet_pb_(text|blurb|image|button|heading|cta|testimonial|slider|gallery|video|video_slider|audio|code|accordion|toggle|tabs|menu|blog|portfolio|filterable_portfolio|shop|contact_form|signup|search|social_media_follow|comments|sidebar|divider|login|fullwidth_header|circle_counter|number_counter|countdown_timer|bar_counters|pricing_tables|map|team_member|person)\b/);
		return match ? match[1] : '';
	}

	function categorizeDiviModule(type) {
		var map = {
			// Text.
			'text': 'text-paragraph', 'blurb': 'text-paragraph', 'heading': 'text-heading',
			'button': 'text-button', 'cta': 'text-button', 'code': 'text-code',
			'testimonial': 'text-quote', 'person': 'text-paragraph',
			'team_member': 'text-paragraph',
			// Images.
			'image': 'image',
			// Gallery.
			'gallery': 'gallery', 'slider': 'gallery',
			'portfolio': 'gallery', 'filterable_portfolio': 'gallery',
			// Video.
			'video': 'video', 'video_slider': 'video',
			// Audio.
			'audio': 'audio',
			// Accordion / Tabs.
			'accordion': 'accordion', 'toggle': 'accordion', 'tabs': 'accordion',
			// Navigation.
			'menu': 'navigation', 'sidebar': 'navigation',
			// Social.
			'social_media_follow': 'social',
			// Interactive / Forms.
			'contact_form': 'interactive', 'signup': 'interactive',
			'search': 'interactive', 'login': 'interactive',
			'comments': 'interactive',
			// Counters / Meta.
			'circle_counter': 'text-meta', 'number_counter': 'text-meta',
			'countdown_timer': 'text-meta', 'bar_counters': 'text-meta',
			'pricing_tables': 'text-list',
			// Posts / Archives.
			'blog': 'text-list', 'shop': 'text-list',
			// Embeds.
			'map': 'embed',
			// Layout.
			'divider': 'layout-section', 'fullwidth_header': 'layout-cover',
		};
		return map[type] || 'unknown';
	}

	function isEditableDiviModule(type) {
		return ['text', 'blurb', 'heading', 'button', 'cta', 'image', 'testimonial',
				'accordion', 'toggle', 'tabs', 'person', 'team_member',
				'circle_counter', 'number_counter', 'pricing_tables',
				'fullwidth_header', 'code'].indexOf(type) !== -1;
	}

	// ── Kadence Blocks Detection ──────────────────────────────────────

	function detectKadenceBlocks() {
		// The page's post id, as buildElementMap reads it (each detector runs on its own).
		var pagePostId = detectPagePostId();
		var selectors = '.kb-advanced-heading-wrapper, .kt-btn-wrap, .kb-icon-list-items, .kt-testimonial-grid-wrap, .kt-accordion-wrap, .kt-tabs-wrap, .kb-image, .kb-gallery-wrap, .kadence-form-wrapper, .kb-countdown-container, .kb-info-box-wrap, .kb-video-popup-wrap, .kb-lottie-container, .kb-show-more-wrap, .kt-row-layout-inner, .kb-posts__wrap, .kb-table-of-content-wrap, .kb-count-up, .kb-progress-bar-container, .kadence-pro-modal';
		var els = document.querySelectorAll(selectors);
		for (var i = 0; i < els.length; i++) {
			var el = els[i];
			if (el.closest('[data-wme-source]')) continue;
			if (el.offsetHeight < 5) continue;

			var type = extractKadenceType(el.className);
			if (!type) continue;

			var uid = 'kadence_' + type + '_' + i;
			el.setAttribute('data-wme-fallback-id', uid);

			var entry = {
				el: el,
				source: 'block',
				blockName: 'kadence/' + type,
				blockUid: uid,
				postId: pagePostId,
				category: categorizeKadenceBlock(type),
				editable: ['advancedheading', 'advancedbtn', 'iconlist', 'testimonials', 'info-box'].indexOf(type) !== -1,
				rect: getElementRect(el),
			};
			elementMap.set(uid, entry);
			elementLookup.set(el, entry);
		}
	}

	function extractKadenceType(classes) {
		if (classes.indexOf('kb-advanced-heading') !== -1) return 'advancedheading';
		if (classes.indexOf('kt-btn-wrap') !== -1) return 'advancedbtn';
		if (classes.indexOf('kb-icon-list') !== -1) return 'iconlist';
		if (classes.indexOf('kt-testimonial') !== -1) return 'testimonials';
		if (classes.indexOf('kt-accordion') !== -1) return 'accordion';
		if (classes.indexOf('kt-tabs') !== -1) return 'tabs';
		if (classes.indexOf('kb-image') !== -1) return 'image';
		if (classes.indexOf('kb-gallery') !== -1) return 'advancedgallery';
		if (classes.indexOf('kadence-form') !== -1) return 'form';
		if (classes.indexOf('kb-countdown') !== -1) return 'countdown';
		if (classes.indexOf('kb-info-box') !== -1) return 'info-box';
		if (classes.indexOf('kb-video-popup') !== -1) return 'video-popup';
		if (classes.indexOf('kb-lottie') !== -1) return 'lottie';
		if (classes.indexOf('kb-show-more') !== -1) return 'show-more';
		if (classes.indexOf('kt-row-layout') !== -1) return 'row-layout';
		if (classes.indexOf('kb-posts') !== -1) return 'posts';
		if (classes.indexOf('kb-table-of-content') !== -1) return 'table-of-contents';
		if (classes.indexOf('kb-count-up') !== -1) return 'count-up';
		if (classes.indexOf('kb-progress-bar') !== -1) return 'progress-bar';
		if (classes.indexOf('kadence-pro-modal') !== -1) return 'modal';
		return '';
	}

	function categorizeKadenceBlock(type) {
		var map = {
			'advancedheading': 'text-heading', 'advancedbtn': 'text-button',
			'iconlist': 'text-list', 'testimonials': 'text-quote',
			'accordion': 'accordion', 'tabs': 'accordion',
			'image': 'image', 'advancedgallery': 'gallery',
			'form': 'interactive', 'countdown': 'interactive', 'info-box': 'text-paragraph',
			'video-popup': 'video', 'lottie': 'media', 'show-more': 'accordion',
			'row-layout': 'layout-section', 'posts': 'text-list',
			'table-of-contents': 'navigation', 'count-up': 'text-meta',
			'progress-bar': 'text-meta', 'modal': 'interactive',
		};
		return map[type] || 'unknown';
	}

	// ── Spectra (UAG) Blocks Detection ────────────────────────────────

	function detectSpectraBlocks() {
		// The page's post id, as buildElementMap reads it (each detector runs on its own).
		var pagePostId = detectPagePostId();
		var selectors = '.uagb-heading-text, .uagb-buttons__outer-wrap, .uagb-image, .uagb-gallery, .uagb-info-box__outer-wrap, .uagb-icon-list__wrap, .uagb-testimonial__wrap, .uagb-cta__outer-wrap, .uagb-faq-layout, .uagb-toc__wrap, .uagb-tabs__wrap, .uagb-forms-main-form, .uagb-star-rating, .uagb-video__outer-wrap, .uagb-social-share__wrap, .uagb-how-to-main-wrap, .uagb-counter, .uagb-post-grid, .uagb-post-carousel, .uagb-post-masonry, .uagb-price-list, .uagb-marketing-btn__wrap, .uagb-timeline, .uagb-review__outer-wrap, .uagb-inline-notice, .uagb-taxonomy-wrap, .uagb-blockquote, .uagb-countdown, .uagb-slider, .uagb-lottie__wrap, .uagb-modal-wrapper';
		var els = document.querySelectorAll(selectors);
		for (var i = 0; i < els.length; i++) {
			var el = els[i];
			if (el.closest('[data-wme-source]')) continue;
			if (el.offsetHeight < 5) continue;

			var type = extractSpectraType(el.className);
			if (!type) continue;

			var uid = 'uagb_' + type + '_' + i;
			el.setAttribute('data-wme-fallback-id', uid);

			var entry = {
				el: el,
				source: 'block',
				blockName: 'uagb/' + type,
				blockUid: uid,
				postId: pagePostId,
				category: categorizeSpectraBlock(type),
				editable: ['advanced-heading', 'buttons', 'info-box', 'testimonial', 'call-to-action'].indexOf(type) !== -1,
				rect: getElementRect(el),
			};
			elementMap.set(uid, entry);
			elementLookup.set(el, entry);
		}
	}

	function extractSpectraType(classes) {
		if (classes.indexOf('uagb-heading-text') !== -1) return 'advanced-heading';
		if (classes.indexOf('uagb-buttons') !== -1) return 'buttons';
		if (classes.indexOf('uagb-image') !== -1 && classes.indexOf('uagb-image-gallery') === -1) return 'image';
		if (classes.indexOf('uagb-gallery') !== -1 || classes.indexOf('uagb-image-gallery') !== -1) return 'image-gallery';
		if (classes.indexOf('uagb-info-box') !== -1) return 'info-box';
		if (classes.indexOf('uagb-icon-list') !== -1) return 'icon-list';
		if (classes.indexOf('uagb-testimonial') !== -1) return 'testimonial';
		if (classes.indexOf('uagb-cta') !== -1) return 'call-to-action';
		if (classes.indexOf('uagb-faq') !== -1) return 'faq';
		if (classes.indexOf('uagb-toc') !== -1) return 'table-of-contents';
		if (classes.indexOf('uagb-tabs') !== -1) return 'tabs';
		if (classes.indexOf('uagb-forms') !== -1) return 'forms';
		if (classes.indexOf('uagb-star-rating') !== -1) return 'star-rating';
		if (classes.indexOf('uagb-video') !== -1) return 'video';
		if (classes.indexOf('uagb-social-share') !== -1) return 'social-share';
		if (classes.indexOf('uagb-how-to') !== -1) return 'how-to';
		if (classes.indexOf('uagb-counter') !== -1) return 'counter';
		if (classes.indexOf('uagb-post-grid') !== -1) return 'post-grid';
		if (classes.indexOf('uagb-post-carousel') !== -1) return 'post-carousel';
		if (classes.indexOf('uagb-post-masonry') !== -1) return 'post-masonry';
		if (classes.indexOf('uagb-price-list') !== -1) return 'price-list';
		if (classes.indexOf('uagb-marketing-btn') !== -1) return 'marketing-button';
		if (classes.indexOf('uagb-timeline') !== -1) return 'timeline';
		if (classes.indexOf('uagb-review') !== -1) return 'review';
		if (classes.indexOf('uagb-inline-notice') !== -1) return 'inline-notice';
		if (classes.indexOf('uagb-taxonomy') !== -1) return 'taxonomy-list';
		if (classes.indexOf('uagb-blockquote') !== -1) return 'blockquote';
		if (classes.indexOf('uagb-countdown') !== -1) return 'countdown';
		if (classes.indexOf('uagb-slider') !== -1) return 'slider';
		if (classes.indexOf('uagb-lottie') !== -1) return 'lottie';
		if (classes.indexOf('uagb-modal') !== -1) return 'modal';
		return '';
	}

	function categorizeSpectraBlock(type) {
		var map = {
			// Text.
			'advanced-heading': 'text-heading', 'buttons': 'text-button',
			'info-box': 'text-paragraph', 'inline-notice': 'text-paragraph',
			'call-to-action': 'text-button', 'marketing-button': 'text-button',
			'blockquote': 'text-quote', 'testimonial': 'text-quote',
			'review': 'text-quote', 'how-to': 'text-list',
			// Lists.
			'icon-list': 'text-list', 'price-list': 'text-list',
			'timeline': 'text-list',
			// Meta.
			'star-rating': 'text-meta', 'counter': 'text-meta',
			'countdown': 'text-meta',
			// Images.
			'image': 'image',
			// Gallery.
			'image-gallery': 'gallery', 'slider': 'gallery',
			// Video.
			'video': 'video',
			// Media.
			'lottie': 'media',
			// Accordion / Tabs.
			'faq': 'accordion', 'tabs': 'accordion',
			// Navigation.
			'table-of-contents': 'navigation', 'taxonomy-list': 'navigation',
			// Social.
			'social-share': 'social',
			// Interactive.
			'forms': 'interactive', 'modal': 'interactive',
			// Posts / Archives.
			'post-grid': 'text-list', 'post-carousel': 'text-list',
			'post-masonry': 'text-list',
		};
		return map[type] || 'unknown';
	}

	// ── GenerateBlocks Detection ──────────────────────────────────────

	function detectGenerateBlocks() {
		// The page's post id, as buildElementMap reads it (each detector runs on its own).
		var pagePostId = detectPagePostId();
		var selectors = '.gb-headline, .gb-button, .gb-image, .gb-container, .gb-grid-column';
		var els = document.querySelectorAll(selectors);
		for (var i = 0; i < els.length; i++) {
			var el = els[i];
			if (el.closest('[data-wme-source]')) continue;
			if (el.offsetHeight < 5) continue;

			var type = extractGenerateBlocksType(el.className);
			if (!type) continue;

			var uid = 'gb_' + type + '_' + i;
			el.setAttribute('data-wme-fallback-id', uid);

			var entry = {
				el: el,
				source: 'block',
				blockName: 'generateblocks/' + type,
				blockUid: uid,
				postId: pagePostId,
				category: categorizeGenerateBlock(type),
				editable: ['headline', 'button'].indexOf(type) !== -1,
				rect: getElementRect(el),
			};
			elementMap.set(uid, entry);
			elementLookup.set(el, entry);
		}
	}

	function extractGenerateBlocksType(classes) {
		if (classes.indexOf('gb-headline') !== -1) return 'headline';
		if (classes.indexOf('gb-button') !== -1) return 'button';
		if (classes.indexOf('gb-image') !== -1) return 'image';
		if (classes.indexOf('gb-container') !== -1) return 'container';
		if (classes.indexOf('gb-grid') !== -1) return 'grid';
		return '';
	}

	function categorizeGenerateBlock(type) {
		var map = {
			'headline': 'text-heading', 'button': 'text-button',
			'image': 'image', 'container': 'layout-section', 'grid': 'layout-section',
		};
		return map[type] || 'unknown';
	}

	// ── Beaver Builder Detection ─────────────────────────────────────

	function detectBeaverBuilderModules() {
		// The page's post id, as buildElementMap reads it (each detector runs on its own).
		var pagePostId = detectPagePostId();
		var els = document.querySelectorAll(
			'.fl-module-rich-text, .fl-module-heading, .fl-module-photo, ' +
			'.fl-module-button, .fl-module-icon, .fl-module-icon-group, ' +
			'.fl-module-callout, .fl-module-cta, .fl-module-contact-form, ' +
			'.fl-module-subscribe-form, .fl-module-accordion, .fl-module-tabs, ' +
			'.fl-module-slider, .fl-module-gallery, .fl-module-slideshow, ' +
			'.fl-module-video, .fl-module-audio, .fl-module-countdown, ' +
			'.fl-module-number, .fl-module-list, .fl-module-pricing-table, ' +
			'.fl-module-testimonials, .fl-module-post-grid, .fl-module-post-carousel, ' +
			'.fl-module-post-slider, .fl-module-content-slider, ' +
			'.fl-module-map, .fl-module-html, .fl-module-menu, ' +
			'.fl-module-search, .fl-module-sidebar, .fl-module-separator, ' +
			'.fl-module-social-buttons, .fl-module-login-form, ' +
			'.fl-module-woocommerce, .fl-module-bigcommerce'
		);
		for (var i = 0; i < els.length; i++) {
			var el = els[i];
			if (el.closest('[data-wme-source]')) continue;
			if (el.offsetHeight < 5) continue;

			var type = extractBeaverBuilderType(el.className);
			if (!type) continue;

			var uid = 'bb_' + type + '_' + i;
			el.setAttribute('data-wme-fallback-id', uid);

			var entry = {
				el: el,
				source: 'beaver-builder',
				blockName: '',
				blockUid: uid,
				postId: pagePostId,
				category: categorizeBeaverBuilderModule(type),
				editable: isEditableBeaverBuilderModule(type),
				rect: getElementRect(el),
			};
			elementMap.set(uid, entry);
			elementLookup.set(el, entry);
		}
	}

	function extractBeaverBuilderType(classes) {
		var match = classes.match(/\bfl-module-(rich-text|heading|photo|button|icon|icon-group|callout|cta|contact-form|subscribe-form|accordion|tabs|slider|gallery|slideshow|video|audio|countdown|number|list|pricing-table|testimonials|post-grid|post-carousel|post-slider|content-slider|map|html|menu|search|sidebar|separator|social-buttons|login-form|woocommerce|bigcommerce)\b/);
		return match ? match[1] : '';
	}

	function categorizeBeaverBuilderModule(type) {
		var map = {
			// Text.
			'rich-text': 'text-paragraph', 'heading': 'text-heading',
			'button': 'text-button', 'callout': 'text-paragraph',
			'cta': 'text-button', 'html': 'text-code',
			'icon': 'image', 'icon-group': 'image',
			'testimonials': 'text-quote',
			// Lists.
			'list': 'text-list', 'pricing-table': 'text-list',
			// Meta / Counters.
			'number': 'text-meta', 'countdown': 'text-meta',
			// Images.
			'photo': 'image',
			// Gallery.
			'gallery': 'gallery', 'slideshow': 'gallery',
			'slider': 'gallery', 'content-slider': 'gallery',
			// Video.
			'video': 'video',
			// Audio.
			'audio': 'audio',
			// Accordion / Tabs.
			'accordion': 'accordion', 'tabs': 'accordion',
			// Navigation.
			'menu': 'navigation', 'sidebar': 'navigation',
			// Social.
			'social-buttons': 'social',
			// Interactive.
			'contact-form': 'interactive', 'subscribe-form': 'interactive',
			'search': 'interactive', 'login-form': 'interactive',
			// Posts / Archives.
			'post-grid': 'text-list', 'post-carousel': 'text-list',
			'post-slider': 'text-list',
			// Embeds.
			'map': 'embed',
			// Layout.
			'separator': 'layout-section',
			// WooCommerce.
			'woocommerce': 'text-list', 'bigcommerce': 'text-list',
		};
		return map[type] || 'unknown';
	}

	function isEditableBeaverBuilderModule(type) {
		return ['rich-text', 'heading', 'button', 'callout', 'cta',
				'testimonials', 'accordion', 'tabs', 'pricing-table',
				'number', 'html'].indexOf(type) !== -1;
	}

	// ── WooCommerce Element Detection ─────────────────────────────────

	function detectWooCommerceElements() {
		// WooCommerce classic template elements (non-block themes).
		var wcSelectors = {
			// Single product page.
			'.product_title': { category: 'text-heading', field: 'title', editable: true },
			'.woocommerce-product-details__short-description': { category: 'text-paragraph', field: 'short_description', editable: true },
			'.woocommerce-Tabs-panel--description': { category: 'wc-description', field: 'description', editable: true },
			'.woocommerce-Tabs-panel--additional_information': { category: 'wc-attribute', field: 'attributes', editable: false },
			'.woocommerce-Tabs-panel--reviews': { category: 'wc-review', field: 'reviews', editable: false },
			'.price': { category: 'wc-price', field: 'price', editable: true },
			'.sku_wrapper .sku': { category: 'text-meta', field: 'sku', editable: true },
			'.stock': { category: 'text-meta', field: 'stock_status', editable: false },
			'.single_add_to_cart_button': { category: 'text-button', field: 'add_to_cart_text', editable: true },
			'.woocommerce-product-gallery': { category: 'gallery', field: 'product_gallery', editable: false },
			'.onsale': { category: 'wc-badge', field: 'sale_badge', editable: true },
			// Archive / shop loop.
			'.woocommerce-loop-product__title': { category: 'text-heading', field: 'title', editable: true },
			'.woocommerce-loop-product__link': { category: 'wc-product-card', field: 'product_card', editable: false },
			// Cart page.
			'.woocommerce-cart-form': { category: 'interactive', field: 'cart_form', editable: false },
			'.cart_totals': { category: 'layout-section', field: 'cart_totals', editable: false },
			// Checkout page.
			'.woocommerce-checkout': { category: 'interactive', field: 'checkout_form', editable: false },
			// My Account.
			'.woocommerce-MyAccount-navigation': { category: 'navigation', field: 'account_nav', editable: false },
			// Category header.
			'.term-description': { category: 'text-paragraph', field: 'term_description', editable: true },
		};

		for (var selector in wcSelectors) {
			var config = wcSelectors[selector];
			var els = document.querySelectorAll(selector);
			for (var i = 0; i < els.length; i++) {
				var el = els[i];
				// Skip if already mapped by block annotation or PHP discovery.
				if (elementLookup.has(el)) continue;
				if (el.closest('[data-wme-source="woocommerce"]')) continue;
				if (el.closest('[data-wme-source="block"]') && el.closest('[data-wme-block-name^="woocommerce/"]')) continue;
				if (el.offsetHeight < 3) continue;

				var postId = getWCProductId(el);
				var uid = 'wc_' + config.field + '_' + (postId || i) + '_' + i;
				el.setAttribute('data-wme-fallback-id', uid);

				var entry = {
					el: el,
					source: 'woocommerce',
					blockName: 'woocommerce/' + config.field,
					blockUid: uid,
					postId: postId,
					category: config.category,
					editable: config.editable,
					rect: getElementRect(el),
					wcField: config.field,
				};
				elementMap.set(uid, entry);
				elementLookup.set(el, entry);
			}
		}

		// Detect WooCommerce product variations (variable products).
		var variationsForm = document.querySelector('.variations_form');
		if (variationsForm && !elementLookup.has(variationsForm)) {
			var varPostId = variationsForm.getAttribute('data-product_id') || getWCProductId(variationsForm);
			var varUid = 'wc_variations_' + varPostId;
			variationsForm.setAttribute('data-wme-fallback-id', varUid);
			var varEntry = {
				el: variationsForm,
				source: 'woocommerce',
				blockName: 'woocommerce/variations',
				blockUid: varUid,
				postId: varPostId,
				category: 'interactive',
				editable: false,
				rect: getElementRect(variationsForm),
				wcField: 'variations',
			};
			elementMap.set(varUid, varEntry);
			elementLookup.set(variationsForm, varEntry);
		}

		// Detect related products section.
		var related = document.querySelector('.related.products');
		if (related && !elementLookup.has(related)) {
			var relUid = 'wc_related_products';
			related.setAttribute('data-wme-fallback-id', relUid);
			var relEntry = {
				el: related,
				source: 'woocommerce',
				blockName: 'woocommerce/related-products',
				blockUid: relUid,
				postId: pagePostId,
				category: 'layout-section',
				editable: false,
				rect: getElementRect(related),
				wcField: 'related_products',
			};
			elementMap.set(relUid, relEntry);
			elementLookup.set(related, relEntry);
		}

		// Detect upsell products section.
		var upsells = document.querySelector('.upsells.products');
		if (upsells && !elementLookup.has(upsells)) {
			var upUid = 'wc_upsell_products';
			upsells.setAttribute('data-wme-fallback-id', upUid);
			var upEntry = {
				el: upsells,
				source: 'woocommerce',
				blockName: 'woocommerce/upsell-products',
				blockUid: upUid,
				postId: pagePostId,
				category: 'layout-section',
				editable: false,
				rect: getElementRect(upsells),
				wcField: 'upsell_products',
			};
			elementMap.set(upUid, upEntry);
			elementLookup.set(upsells, upEntry);
		}
	}

	/**
	 * Try to extract the WooCommerce product ID from context.
	 */
	function getWCProductId(el) {
		// Check closest product wrapper for data-wme-post-id.
		var annotated = el.closest('[data-wme-post-id]');
		if (annotated) return annotated.getAttribute('data-wme-post-id');

		// WooCommerce classic templates: body class or .product wrapper.
		var productDiv = el.closest('.product[class*="post-"]');
		if (productDiv) {
			var match = productDiv.className.match(/\bpost-(\d+)\b/);
			if (match) return match[1];
		}

		// Body class on single product pages.
		var bodyMatch = document.body.className.match(/\bpostid-(\d+)\b/);
		if (bodyMatch) return bodyMatch[1];

		// Variations form.
		var form = el.closest('.variations_form[data-product_id]');
		if (form) return form.getAttribute('data-product_id');

		return '';
	}

	// ── Element Rect ─────────────────────────────────────────────────

	function getElementRect(el) {
		var r = el.getBoundingClientRect();
		return { top: r.top, left: r.left, width: r.width, height: r.height, bottom: r.bottom, right: r.right };
	}

	/**
	 * How a part looks, for the editor's "working on it" glass drawn over it (2026-10-19): its corner
	 * radius (a wrapper takes its only child's) and whether what shows behind the glass is light or
	 * dark: the first background colour up from the part, else its words' colour read the other way
	 * (light words sit on a dark picture).
	 */
	function lookOf(el) {
		var r = el.getBoundingClientRect();
		var radiusOf = function (n) {
			var v = getComputedStyle(n).borderTopLeftRadius || '';
			var x = parseFloat(v) || 0;
			return /%/.test(v.split(' ')[0]) ? (x / 100) * r.width : x;
		};
		var radius = radiusOf(el);
		if (!radius && el.children.length === 1 && sameBox(r, el.children[0].getBoundingClientRect())) radius = radiusOf(el.children[0]);
		var rgb = function (v) {
			var m = /rgba?\(([\d.]+)[, ]+([\d.]+)[, ]+([\d.]+)(?:[, /]+([\d.]+))?/.exec(v || '');
			return m ? { l: (0.2126 * m[1] + 0.7152 * m[2] + 0.0722 * m[3]) / 255, a: m[4] === undefined ? 1 : parseFloat(m[4]) } : null;
		};
		var tone = '';
		for (var n = el; n && n.nodeType === 1 && !tone; n = n.parentElement) {
			var cs = getComputedStyle(n);
			var bg = rgb(cs.backgroundColor);
			if (bg && bg.a >= 0.5) tone = bg.l < 0.5 ? 'dark' : 'light';
			else if (cs.backgroundImage && cs.backgroundImage !== 'none') {
				var ink = rgb(getComputedStyle(el).color);
				tone = ink && ink.l > 0.6 ? 'dark' : 'light';
			}
		}
		return { radius: Math.round(Math.min(radius, r.width / 2, r.height / 2)), tone: tone || 'light' };
	}

	// Always return plain objects, never live DOMRect.
	function toPlainRect(domRect) {
		return {
			top: domRect.top,
			left: domRect.left,
			width: domRect.width,
			height: domRect.height,
			bottom: domRect.bottom,
			right: domRect.right,
		};
	}

	// ── Position Tracking ──────────────────────────────────────────────

	function updateAndSendPositions() {
		if (mode === 'bindings') { sendBindingPositions(); return; }
		if (mode === null) return;
		var positions = {};
		elementMap.forEach(function (entry, uid) {
			entry.rect = getElementRect(entry.el);
			positions[uid] = rectToObj(entry.rect);
		});
		for (var fi = 0; fi < followUids.length; fi++) {
			var fel = positions[followUids[fi]] ? null : partEl(followUids[fi]);
			if (fel) positions[followUids[fi]] = rectToObj(getElementRect(fel));
		}
		notifyParent('wme:positions', positions);
		// A part a panel outlined (its address) follows the page too.
		if (withBindings && selectedBinding) sendBindingPositions();
	}

	// ── Hover & Click ──────────────────────────────────────────────────

	var hoveredEntry = null;


	// The editor's own handlers listen at the window, which hears an event
	// before any listener of the page (holdEvent then keeps it from the page).
	window.addEventListener('mousemove', function (e) {
		if (mode === 'bindings') { onBindingHover(e); return; }
		// On the product page itself, a dimmed own part outlines nothing: a click on it crosses instead.
		var target = viewMode === 'template' && crossingAt(e.target) ? null : partAt(e);
		// Inside a part WPMaven is working on: nothing outlined (its glass is the outline).
		if (target && heldBy(target)) target = null;

		if (target !== hoveredEntry) {
			hoveredEntry = target;

			if (target) {
				target.rect = getElementRect(target.el);
				notifyParent('wme:hover', withDescription({
					uid: target.blockUid,
					rect: rectToObj(target.rect),
					category: target.category,
					blockName: target.blockName,
					editable: target.editable,
				}, target));
			} else {
				notifyParent('wme:hover-out', {});
			}
		}
	}, { passive: true, capture: true });

	// The page's own fields and buttons do nothing in the editor: a field
	// takes no focus and no typing, a list does not open, a slider does not
	// move, a button does not press; a press on one selects it (2026-10-18).
	// The words being edited in place keep their caret.
	window.addEventListener('mousedown', function (e) {
		if (mode === null || !e.target || !e.target.closest) return;
		var field = e.target.closest('input, select, textarea, option, button');
		if (!field) return;
		var editing = editingUid ? elementMap.get(editingUid) : null;
		if (editing && editing.el.contains(field)) return;
		e.preventDefault();
	}, true);
	window.addEventListener('focusin', function (e) {
		if (mode === null || !e.target || !e.target.matches || !e.target.matches('input, select, textarea')) return;
		e.target.blur();
	}, true);

	// Block ALL link navigation — the sidebar controls page/template switching.
	window.addEventListener('click', function (e) {
		if (mode === 'bindings') { onBindingClick(e); return; }
		var link = e.target.closest('a[href]');
		if (link) {
			var href = link.getAttribute('href');
			if (href && !href.startsWith('#') && !href.startsWith('javascript:')) {
				e.preventDefault();
				e.stopPropagation();
				// Notify parent about the clicked link (sidebar can offer to navigate)
				notifyParent('wme:link-click', {
					href: href,
					text: (link.textContent || '').substring(0, 100).trim(),
				});
				// Don't return — fall through to element selection if the link is mapped
			}
		}

		// Block form submissions but still allow element selection.
		if (e.target.closest('form') && e.target.type === 'submit') {
			e.preventDefault();
		}
		// A field (and its label) never acts: no tick, no choice, no focus.
		if (e.target.closest('input, select, textarea, label')) e.preventDefault();

		// A dimmed part of the other editor (the record's own on the product page itself, the
		// product page's in the product editor): a note at the pointer offers to cross (2026-10-19).
		var crossing = editingUid ? null : crossingAt(e.target);
		if (crossing) {
			e.preventDefault();
			e.stopPropagation();
			crossNode = e.target;
			crossing.x = e.clientX;
			crossing.y = e.clientY;
			notifyParent('wme:crossing', crossing);
			return;
		}

		var target = partAt(e);
		if (!target) return;
		var held = heldBy(target);
		if (held) {
			e.preventDefault();
			e.stopPropagation();
			notifyParent('wme:busy-click', { uid: held });
			return;
		}

		// In editing mode, suppress all default behavior except media playback.
		var tag = e.target.tagName;
		if (tag === 'VIDEO' || tag === 'AUDIO') return;

		// If clicking inside the element being edited (a link inside a
		// paragraph too), allow normal behavior so the user can position the
		// cursor. The page's scripts never hear it (holdEvent).
		if (editingUid && insideEditing(e.target)) return;

		// Alt+Click: select the parent mapped element instead.
		if (e.altKey) {
			var parentNode = target.el.parentElement;
			while (parentNode && parentNode !== document.body) {
				var parentEntry = elementLookup.get(parentNode);
				if (parentEntry) {
					target = parentEntry;
					break;
				}
				parentNode = parentNode.parentElement;
			}
		}

		e.preventDefault();
		e.stopPropagation();

		selectEntry(target);
	}, true);

	/** Selects a part: the editor hears what it is, where it sits and what it does (a click, or the window's Whole Form). */
	function selectEntry(target) {
		// Compute fresh rect at click time — cached rect may be stale.
		target.rect = getElementRect(target.el);

		var selectPayload = {
			uid: target.blockUid,
			rect: rectToObj(target.rect),
			source: target.source,
			blockName: target.blockName,
			postId: target.postId,
			category: target.category,
			editable: target.editable,
			content: target.el.innerHTML || target.el.outerHTML,
			textContent: wordsOf(target.el),
			look: lookOf(target.el),
		};

		// Add source-specific metadata.
		if (target.source === 'acf') {
			selectPayload.fieldName = target.el.getAttribute('data-wme-field-name') || '';
			selectPayload.fieldKey = target.el.getAttribute('data-wme-field-key') || '';
		} else if (target.source === 'elementor') {
			selectPayload.widgetType = target.el.getAttribute('data-widget_type') || '';
			selectPayload.widgetId = target.el.getAttribute('data-id') || '';
		} else if (target.source === 'divi') {
			selectPayload.moduleType = target.el.getAttribute('data-wme-module-type') || '';
		} else if (target.source === 'woocommerce') {
			selectPayload.wcField = target.wcField || target.el.getAttribute('data-wme-wc-field') || '';
			selectPayload.wcProductType = target.el.getAttribute('data-wme-wc-product-type') || '';
			selectPayload.wcRegularPrice = target.el.getAttribute('data-wme-wc-regular-price') || '';
			selectPayload.wcSalePrice = target.el.getAttribute('data-wme-wc-sale-price') || '';
			selectPayload.wcTermId = target.el.getAttribute('data-wme-wc-term-id') || '';
		}

		// Where the change is saved (template part, site setting, menu item, term).
		var route = routingOf(target.el);
		for (var rk in route) {
			if (Object.prototype.hasOwnProperty.call(route, rk) && route[rk]) selectPayload[rk] = route[rk];
		}

		// Add theme.json style context if present.
		var styles = target.el.getAttribute('data-wme-styles');
		if (styles) {
			selectPayload.styles = styles;
			selectPayload.styleEditable = target.el.getAttribute('data-wme-style-editable') === 'true';
		}

		// Its address in the edit engine: the section, header or footer it sits in, the card, the drill.
		// On a post's or a product's own page the template is not its place: the post or the product is.
		var engine = engineAddressOf(target.el);
		if (engine && target.single) engine.container = null;
		if (engine && (engine.container || engine.object || engine.drill)) selectPayload.engine = engine;

		notifyParent('wme:select', behaviorOf(target.el, withDescription(selectPayload, target)));
	}

	window.addEventListener('keydown', function (e) {
		// The words being edited in place: Escape cancels, Enter ends a heading or a button.
		if (editingUid && insideEditing(e.target)) onEditingKeydown(e);
		if (e.key === 'Escape') {
			if (editingUid) {
				cancelEditing();
			}
			if (mode === 'bindings') selectedBinding = null;
			notifyParent('wme:deselect', {});
		}
	}, true);
	window.addEventListener('input', function (e) {
		if (editingUid && insideEditing(e.target)) onEditingInput();
	}, true);

	/** Inside the element whose words are being edited in place. */
	function insideEditing(node) {
		var entry = editingUid ? elementMap.get(editingUid) : null;
		return !!(entry && node && entry.el.contains(node));
	}

	/**
	 * The page's own scripts never hear the owner in the editor (2026-10-18):
	 * a click, a press, a key or the pointer reaches the editor's handlers
	 * above and stops at the window, so a button opens no drawer or sidebar,
	 * a card adds nothing to the cart, a form sends nothing, a menu does not
	 * toggle, and nothing comes over the page to lock the editor. What the
	 * browser itself does stays (the caret and the typing in the words being
	 * edited, a video's controls); a form never sends and nothing is dragged.
	 */
	var HELD_EVENTS = [
		'click', 'dblclick', 'auxclick', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'touchstart', 'touchend',
		'mousemove', 'mouseover', 'mouseout', 'mouseenter', 'mouseleave',
		'pointermove', 'pointerover', 'pointerout', 'pointerenter', 'pointerleave',
		'keydown', 'keyup', 'keypress', 'focusin', 'input', 'change', 'submit', 'dragstart',
	];
	var QUIET_EVENTS = /^(touch|mouse(move|over|out|enter|leave)|pointer(move|over|out|enter|leave))/;

	function holdEvent(e) {
		if (mode !== 'legacy') return;
		if (e.type === 'submit') e.preventDefault();
		if (e.type === 'dragstart' && !insideEditing(e.target)) e.preventDefault();
		e.stopPropagation();
	}
	for (var he = 0; he < HELD_EVENTS.length; he++) {
		window.addEventListener(HELD_EVENTS[he], holdEvent, { capture: true, passive: QUIET_EVENTS.test(HELD_EVENTS[he]) });
	}

	/** The plugins whose output a part can be, by the markup they leave (the first match wins). */
	var PLUGIN_MARKS = [
		['.wpforms-container, [data-wm-form]', 'WPForms'],
		['.wpcf7', 'Contact Form 7'],
		['.gform_wrapper', 'Gravity Forms'],
		['.frm_forms', 'Formidable Forms'],
		['.fluentform', 'Fluent Forms'],
		['.nf-form-cont', 'Ninja Forms'],
		['.mc4wp-form', 'Mailchimp for WordPress'],
		['.tribe-events, .tribe-common', 'The Events Calendar'],
		['[data-wm-product], .woocommerce, [class*="wc-block"], li.product', 'WooCommerce'],
	];
	/** A block's plugin by its name's namespace (core blocks are WordPress's own). */
	var PLUGIN_NAMESPACES = {
		woocommerce: 'WooCommerce', wpforms: 'WPForms', jetpack: 'Jetpack', 'yoast-seo': 'Yoast SEO', yoast: 'Yoast SEO',
		kadence: 'Kadence Blocks', uagb: 'Spectra', generateblocks: 'GenerateBlocks', 'contact-form-7': 'Contact Form 7',
		gravityforms: 'Gravity Forms', 'mailchimp-for-wp': 'Mailchimp for WordPress',
	};
	var SOURCE_PLUGINS = { elementor: 'Elementor', divi: 'Divi', beaver: 'Beaver Builder', acf: 'ACF', woocommerce: 'WooCommerce' };

	/**
	 * What WordPress draws itself: its blocks (a post's words, a page made in
	 * WordPress, the blocks added between WPMaven's sections), its comments,
	 * its search form, its post navigation and its pagination.
	 */
	var WORDPRESS_MARKS = '[data-wme-block-name^="core/"]:not([data-wme-designed="true"]), .comments-area, #comments, .comment-respond, .wp-block-comments, .search-form, .wp-block-search, .post-navigation, .posts-navigation, .nav-links, .pagination, .page-numbers, [class*="wp-block-"]';

	/** A site WPMaven designed (its sections or its header and footer on the page): WordPress's own parts stand apart there. */
	var designedSite = false;

	/**
	 * The plugin a part comes from, '' for WPMaven's design or the theme's.
	 * WordPress's own parts are named like a plugin's (2026-10-18) on a site
	 * WPMaven designed; on a site WordPress draws all of, none stands apart.
	 */
	function pluginOf(entry) {
		var ns = /^([a-z0-9-]+)\//.exec(entry.blockName || '');
		if (ns && ns[1] !== 'core') return PLUGIN_NAMESPACES[ns[1]] || humanize(ns[1]);
		if (SOURCE_PLUGINS[entry.source]) return SOURCE_PLUGINS[entry.source];
		for (var i = 0; i < PLUGIN_MARKS.length; i++) {
			var root = entry.el.closest(PLUGIN_MARKS[i][0]);
			if (root && root !== document.body && root !== document.documentElement) return PLUGIN_MARKS[i][1];
		}
		if (designedSite && !entry.el.closest('[data-wm-section], [data-wm-chrome], [data-wme-designed="true"]')) {
			var wp = entry.el.closest(WORDPRESS_MARKS);
			if (wp && wp !== document.body && wp !== document.documentElement) return 'WordPress';
		}
		return '';
	}

	/** A header or footer of the page itself (not one inside a card or a section). */
	function chromeRegionOf(el) {
		if (el.hasAttribute('data-wm-chrome')) return el.getAttribute('data-wm-chrome') === 'footer' ? 'footer' : 'header';
		var tag = el.tagName;
		if ((tag !== 'HEADER' && tag !== 'FOOTER') || hasSectionAncestor(el) || el.closest('main, article')) return '';
		return tag === 'FOOTER' ? 'footer' : 'header';
	}

	var TAG_WORDS = { NAV: 'Navigation', UL: 'List', OL: 'List', TABLE: 'Table', FIGURE: 'Figure', BLOCKQUOTE: 'Quote', ARTICLE: 'Article', SECTION: 'Section' };
	var BINDING_WORDS = { section: 'Section', product: 'Product', post: 'Post', form: 'Form', image: 'Image', fact: 'Business detail', 'menu-item': 'Menu item', social: 'Social links' };

	/**
	 * What the outline names a part: { label, kind, plugin, live }. The
	 * engine's own parts first (the header, the footer, a section, a card, a
	 * form), then a list of live cards, then what its tag says. live: it
	 * shows what the store or the blog holds now. label '' leaves the
	 * editor's own name (the block's, the category's).
	 */
	function describeEntry(entry) {
		var el = entry.el;
		var out = { label: '', kind: '', plugin: pluginOf(entry), live: false };
		var own = withBindings ? (bindingsByEl.get(el) || []) : [];
		for (var i = 0; i < own.length; i++) {
			var b = own[i];
			// A post's blocks on its own page are its words, not sections.
			if (entry.single && (b.kind === 'section' || b.kind === 'chrome')) continue;
			if (b.kind === 'chrome') return { label: b.region === 'footer' ? 'Footer' : 'Header', kind: 'chrome', plugin: '', live: false };
			if (BINDING_WORDS[b.kind]) {
				out.label = BINDING_WORDS[b.kind];
				out.kind = b.kind;
				out.live = b.kind === 'product' || b.kind === 'post';
				if (b.kind === 'section') out.plugin = '';
				return out;
			}
		}
		var region = chromeRegionOf(el);
		if (region) return { label: region === 'footer' ? 'Footer' : 'Header', kind: 'chrome', plugin: '', live: false };
		if (liveCardsIn(el) >= 2) {
			var products = el.querySelector(':scope > [data-wm-product], :scope > li.product, :scope > .wc-block-grid__product, :scope > .wc-block-product');
			out.label = products ? 'Product list' : 'Post list';
			out.kind = 'collection';
			out.live = true;
			if (products) out.plugin = 'WooCommerce';
			return out;
		}
		if (el.matches(LIVE_CARDS)) {
			out.label = el.matches('[data-wm-post]') ? 'Post' : 'Product';
			out.kind = el.matches('[data-wm-post]') ? 'post' : 'product';
			out.live = true;
			return out;
		}
		if (el.matches(ANY_FORM)) {
			out.label = isSearchForm(el) ? 'Search form' : 'Form';
			out.kind = 'form';
			return out;
		}
		// A field, a label, an embed, a section's card, grid, row or group.
		if (entry.word) {
			out.label = entry.word;
			out.kind = entry.kind || '';
			return out;
		}
		// A designed section's block is a Custom HTML block: never named after it.
		if (entry.blockName === 'core/html' && el.getAttribute('data-wme-designed') === 'true') out.label = 'Section';
		else if (!entry.blockName && entry.source === 'semantic') out.label = TAG_WORDS[el.tagName] || '';
		return out;
	}

	/** Plugins that build a site's own pages (their parts are the site's, not a plugin's feature). */
	var BUILDER_PLUGINS = { Elementor: 1, Divi: 1, 'Beaver Builder': 1, 'Kadence Blocks': 1, Spectra: 1, GenerateBlocks: 1, ACF: 1 };
	/** WPMaven's own parts that show a plugin's data (a designed form, a designed product or post card). */
	var DESIGNED_PLUGIN_MARKS = '[data-wm-form], [data-wm-product], [data-wm-post]';

	/** describeEntry's fields onto a hover or select payload. */
	function withDescription(payload, entry) {
		var d = describeEntry(entry);
		if (d.label) payload.label = d.label;
		if (d.kind) payload.kind = d.kind;
		if (d.plugin) payload.plugin = d.plugin;
		if (d.live) payload.live = true;
		// drawn: the plugin (or WordPress) draws it itself (its form, its shop
		// block, a post's words), outlined apart.
		if (d.plugin && !BUILDER_PLUGINS[d.plugin] && (d.plugin === 'WordPress' || !entry.el.closest(DESIGNED_PLUGIN_MARKS))) payload.drawn = true;
		// What it prints on beyond this page (the Template tag), a category's own words, and the
		// record's content a part of the product page holds (2026-10-19).
		if (entry.reach) {
			payload.template = entry.reach;
			// The product page itself is WPMaven's design, not WooCommerce's (a related product's card stays the store's).
			var card = viewMode === 'template' && entry.el.closest('[data-wm-product], [data-wm-post]');
			if (card && card === recordRoot(singleView())) { delete payload.plugin; delete payload.drawn; }
		}
		if (entry.term) payload.term = entry.term;
		if (entry.holdsOwn) payload.holdsOwn = true;
		// A post's or a product's own page: its content is the post's or the product's (changed there).
		if (entry.single) {
			payload.single = entry.single;
			payload.plugin = entry.single === 'product' ? 'WooCommerce' : 'WordPress';
			payload.drawn = true;
			// The part of the post or the product it is in, and a gallery picture's place (2026-10-19).
			if (entry.ownPart) payload.ownPart = entry.ownPart;
			if (typeof entry.picture === 'number') payload.picture = entry.picture;
			if (entry.dimension) payload.dimension = entry.dimension;
			if (entry.empty) payload.empty = true;
		}
		return payload;
	}

	/**
	 * What the window shows and offers for a part (2026-10-18): where a link
	 * goes (its address as written, the address it resolves to, its tab), a
	 * field's state (its type, required, placeholder, choices), and what a
	 * button does (sends its form, adds a product to the cart).
	 */
	function behaviorOf(el, payload) {
		var link = el.matches('a[href]') ? el : el.closest('a[href]');
		if (link && !el.hasAttribute('data-wm-section') && !el.hasAttribute('data-wm-chrome')) {
			payload.link = {
				href: link.getAttribute('href') || '',
				url: link.href || '',
				target: link.getAttribute('target') || '',
				download: link.hasAttribute('download'),
			};
		}
		var field = /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName) ? el : null;
		if (!field && el.querySelectorAll) {
			var inner = el.querySelectorAll(FIELDS);
			if (inner.length === 1 && el.querySelector('label')) field = inner[0];
		}
		if (field && !/^(submit|button|reset|image)$/i.test(field.getAttribute('type') || '')) {
			var options = [];
			if (field.tagName === 'SELECT') {
				for (var o = 0; o < field.options.length && options.length < 30; o++) {
					var said = (field.options[o].textContent || '').replace(/\s+/g, ' ').trim();
					if (said) options.push(said.substring(0, 80));
				}
			}
			payload.field = {
				type: field.tagName === 'INPUT' ? (field.getAttribute('type') || 'text').toLowerCase() : field.tagName.toLowerCase(),
				word: fieldWord(field),
				required: !!field.required,
				placeholder: (field.getAttribute('placeholder') || '').substring(0, 120),
				options: options,
				multiple: !!field.multiple,
			};
		}
		var formRoot = el.parentElement ? el.parentElement.closest(ANY_FORM) : null;
		while (formRoot && formRoot.parentElement && formRoot.parentElement.closest(ANY_FORM)) formRoot = formRoot.parentElement.closest(ANY_FORM);
		var formEntry = formRoot ? elementLookup.get(formRoot) : null;
		if (formEntry && !el.hasAttribute('data-wm-section') && !el.hasAttribute('data-wm-chrome')) payload.inForm = formEntry.blockUid;
		var adds = el.closest('[data-action="add-to-cart"]');
		if (adds) {
			var card = adds.closest('[data-product]');
			var nameEl = card ? card.querySelector('[data-wm-field="name"]') : null;
			var product = (nameEl && nameEl.textContent) || (card && card.getAttribute('data-product')) || '';
			payload.button = { does: 'add-to-cart', product: product.replace(/\s+/g, ' ').trim().substring(0, 120) };
		} else if (el.matches('button, input[type="submit"]') && (el.getAttribute('type') || 'submit').toLowerCase() === 'submit') {
			var form = el.closest('form, [data-wm-form]');
			if (form) payload.button = { does: 'submit', form: form.getAttribute('data-wm-form') || form.getAttribute('aria-label') || '' };
		}
		return payload;
	}

	/**
	 * The bindings holding an element, for the edit engine: the section, header
	 * or footer it sits in (the innermost), the product or post card, and an
	 * image, fact, menu item or form it is (or sits in). Null without bindings.
	 */
	function engineAddressOf(el) {
		if (!withBindings || !bindings.length) return null;
		var chain = chainOf(el);
		var container = null;
		var object = null;
		var drill = null;
		// The product page itself: the product shown is an example, never the part's own card.
		var example = viewMode === 'template' ? recordRoot(singleView()) : null;
		for (var i = 0; i < chain.length; i++) {
			if (!container && CONTAINERS[chain[i].kind]) container = chain[i];
			if (!object && OBJECTS[chain[i].kind] && chain[i].el !== example) object = chain[i];
			if (!drill && DRILLS[chain[i].kind]) drill = chain[i];
		}
		if (!container && !object && !drill) return null;
		return {
			container: container ? describe(container, true) : null,
			object: object ? describe(object, true) : null,
			drill: drill ? describe(drill, true) : null,
		};
	}

	/**
	 * Walk up from event target to find the nearest mapped element.
	 * Uses WeakMap for O(1) lookup instead of iterating the full map.
	 */
	function findMappedElement(target) {
		var current = target;
		while (current && current !== document.body) {
			var entry = elementLookup.get(current);
			if (entry) return entry;
			// Fallback: DOM node may have been replaced after map build
			// (theme JS, lazy loading, previews). Recover via UID attribute.
			if (current.hasAttribute && current.hasAttribute('data-wme-block-uid')) {
				var uid = current.getAttribute('data-wme-block-uid');
				entry = elementMap.get(uid);
				if (entry) {
					entry.el = current;
					elementLookup.set(current, entry);
					return entry;
				}
			}
			current = current.parentElement;
		}
		return null;
	}

	function rectToObj(rect) {
		return {
			top: rect.top,
			left: rect.left,
			width: rect.width,
			height: rect.height,
			bottom: rect.bottom,
			right: rect.right,
		};
	}

	// ── Inline Text Editing ────────────────────────────────────────────

	/** @type {string|null} UID of element currently being edited inline. */
	var editingUid = null;

	/** @type {string|null} Original innerHTML before editing started. */
	var editingOriginal = null;

	var TEXT_CATEGORIES = ['text-heading', 'text-paragraph', 'text-button',
		'text-quote', 'text-list', 'text-table', 'text-code', 'text-meta', 'text-link'];

	function enableEditing(uid) {
		// Disable any current editing first.
		if (editingUid) disableEditing(true);

		var entry = elementMap.get(uid);
		if (!entry) return;

		// Only allow inline editing for text categories.
		if (TEXT_CATEGORIES.indexOf(entry.category) === -1) return;

		editingUid = uid;
		editingOriginal = entry.el.innerHTML;

		entry.el.setAttribute('contenteditable', 'true');
		entry.el.style.outline = 'none';
		entry.el.style.cursor = 'text';
		entry.el.focus();

		// Listen for blur to finish editing. Its input (the box follows the
		// words) and its keys (Escape cancels, Enter ends a heading or a
		// button) are heard at the window, where the page never hears them.
		entry.el.addEventListener('blur', onEditingBlur);
	}

	var editingInputTimer = null;

	function onEditingInput() {
		if (!editingUid) return;
		// Debounce: update all positions since a reflow may shift everything below.
		clearTimeout(editingInputTimer);
		editingInputTimer = setTimeout(function () {
			updateAndSendPositions();
		}, 60);
	}

	function disableEditing(silent) {
		if (!editingUid) return;

		var entry = elementMap.get(editingUid);
		if (entry) {
			var newHTML = entry.el.innerHTML;
			entry.el.removeAttribute('contenteditable');
			entry.el.style.outline = '';
			entry.el.style.cursor = '';
			entry.el.removeEventListener('blur', onEditingBlur);

			// Send changes to parent if content actually changed.
			if (!silent && newHTML !== editingOriginal) {
				var editPayload = {
					uid: editingUid,
					content: newHTML,
					source: entry.source,
					blockName: entry.blockName,
					postId: entry.postId,
					category: entry.category,
				};
				// Source-specific metadata for backend handlers.
				if (entry.source === 'elementor') {
					editPayload.widgetId = entry.el.getAttribute('data-id') || '';
					editPayload.widgetType = (entry.el.getAttribute('data-widget_type') || '').split('.')[0];
				} else if (entry.source === 'divi') {
					editPayload.moduleType = entry.el.getAttribute('data-wme-module-type') || '';
				} else if (entry.source === 'acf') {
					editPayload.fieldName = entry.el.getAttribute('data-wme-field-name') || '';
					editPayload.fieldKey = entry.el.getAttribute('data-wme-field-key') || '';
				} else if (entry.source === 'woocommerce') {
					editPayload.wcField = entry.wcField || entry.el.getAttribute('data-wme-wc-field') || '';
				}
				var editRoute = routingOf(entry.el);
				for (var ek in editRoute) {
					if (Object.prototype.hasOwnProperty.call(editRoute, ek) && editRoute[ek]) editPayload[ek] = editRoute[ek];
				}
				notifyParent('wme:editing-done', editPayload);
			}
		}

		editingUid = null;
		editingOriginal = null;
	}

	function cancelEditing() {
		if (!editingUid) return;
		var entry = elementMap.get(editingUid);
		if (entry && editingOriginal !== null) {
			suppressObserver = true;
			entry.el.innerHTML = editingOriginal;
			suppressObserver = false;
		}
		disableEditing(true);
	}

	function onEditingBlur() {
		// Small delay to allow click-on-another-element to fire first.
		setTimeout(function () { disableEditing(false); }, 150);
	}

	function onEditingKeydown(e) {
		if (e.key === 'Escape') {
			e.preventDefault();
			cancelEditing();
			return;
		}
		// For single-line elements (headings, buttons), Enter finishes editing.
		var entry = editingUid ? elementMap.get(editingUid) : null;
		if (entry && (entry.category === 'text-heading' || entry.category === 'text-button') && e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			entry.el.blur();
		}
	}

	// ── Live Preview ───────────────────────────────────────────────────

	var originalContent = new Map();

	/**
	 * Sanitize preview HTML with DOMPurify (editor/assets/vendor/purify.min.js,
	 * enqueued as this script's dependency). The content is model output drawn
	 * onto the live page under the editor's session, so everything that can run
	 * script goes (handlers, javascript: URLs, script, iframe srcdoc, object,
	 * embed); inline styles, forms and http(s) embeds stay so the preview
	 * matches the page. Returns null when DOMPurify is missing: no preview then,
	 * never unsanitized HTML.
	 */
	function sanitizePreviewHTML(html) {
		var purify = window.DOMPurify;
		if (!purify || typeof purify.sanitize !== 'function') return null;
		return purify.sanitize(String(html == null ? '' : html), {
			ADD_TAGS: ['iframe'],
			ADD_ATTR: ['allow', 'allowfullscreen', 'frameborder', 'loading', 'referrerpolicy']
		});
	}

	function applyPreview(uid, newContent) {
		var entry = elementMap.get(uid);
		if (!entry) return;

		// Sanitize before applying; without the sanitizer nothing is applied.
		var clean = sanitizePreviewHTML(newContent);
		if (clean === null) return;

		// Store original innerHTML for discard.
		if (!originalContent.has(uid)) {
			originalContent.set(uid, entry.el.innerHTML);
		}

		suppressObserver = true;
		entry.el.innerHTML = clean;
		suppressObserver = false;

		// Update rect and notify parent so the selection box resizes.
		entry.rect = getElementRect(entry.el);
		var pos = {}; pos[uid] = rectToObj(entry.rect);
		notifyParent('wme:positions', pos);
	}

	function discardPreview(uid) {
		var original = originalContent.get(uid);
		if (original === undefined) return;

		var entry = elementMap.get(uid);
		if (entry) {
			suppressObserver = true;
			entry.el.innerHTML = original;
			suppressObserver = false;
			entry.rect = getElementRect(entry.el);
			var pos = {}; pos[uid] = rectToObj(entry.rect);
			notifyParent('wme:positions', pos);
		}

		originalContent.delete(uid);
	}

	// ── Bindings: a site WPMaven built ─────────────────────────────────
	//
	// The compiled site carries its own addresses (data-wm-*): sections, the
	// header and footer, product and post cards, menu items, business facts
	// (data-content="var:<key>") and images (data-slot). The editor selects
	// through them; content compiled before them falls back to section[id]
	// in the page and to the first header and the last footer.
	//
	// A click selects a section, or the header or the footer; a second click
	// inside the selected one reaches what is in it (an image, a fact, a menu
	// item). Product and post cards are selected at once (they have their own
	// forms). Alt+click goes back out to the section. Nothing navigates.

	/** The page slug the editor read from its site map (content compiled before data-wm-page). */
	var pageHint = '';
	/** @type {Array<Object>} */
	var bindings = [];
	/** @type {Map<Element, Array<Object>>} */
	var bindingsByEl = new Map();
	var hoveredBinding = null;
	/** The uid of the selected binding. */
	var selectedBinding = null;
	/** Token values set live by the Design panel: name -> the inline value before. */
	var tokenBackup = {};

	var CONTAINERS = { section: true, chrome: true };
	var OBJECTS = { product: true, post: true };
	var DRILLS = { image: true, fact: true, 'menu-item': true, form: true };
	var FORM_WORDS = { contact: 'Contact form', quote: 'Quote request form', booking: 'Booking form', newsletter: 'Newsletter signup', feedback: 'Feedback form', order: 'Order form' };

	function squash(text, max) {
		return String(text || '').replace(/\s+/g, ' ').trim().slice(0, max);
	}

	function humanize(id) {
		var s = String(id || '').replace(/[-_]+/g, ' ').trim();
		return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
	}

	function hasSectionAncestor(el) {
		var p = el.parentElement;
		while (p) {
			if (p.tagName === 'SECTION') return true;
			p = p.parentElement;
		}
		return false;
	}

	function pageOf(el) {
		var withPage = el.closest('[data-wm-page]');
		return (withPage && withPage.getAttribute('data-wm-page')) || pageHint || '';
	}

	function visible(el) {
		var r = el.getBoundingClientRect();
		return r.width > 0 || r.height > 0;
	}

	function addBinding(kind, key, el, props) {
		var uid = kind + ':' + key;
		var n = 1;
		while (bindings.some(function (b) { return b.uid === uid; })) {
			n++;
			uid = kind + ':' + key + '#' + n;
		}
		var entry = { uid: uid, kind: kind, el: el };
		for (var k in props) {
			if (Object.prototype.hasOwnProperty.call(props, k) && props[k] !== undefined && props[k] !== '' && props[k] !== null) entry[k] = props[k];
		}
		bindings.push(entry);
		var list = bindingsByEl.get(el);
		if (!list) {
			list = [];
			bindingsByEl.set(el, list);
		}
		list.push(entry);
		return entry;
	}

	function productIdFor(el, slug) {
		var direct = parseInt(el.getAttribute('data-wm-product-id') || '', 10);
		if (direct > 0) return direct;
		var map = window.wmWp && window.wmWp.products;
		var p = map && slug ? map[slug] : null;
		return p && p.id ? parseInt(p.id, 10) || 0 : 0;
	}

	function imageOf(el) {
		if (el.tagName === 'IMG') return el;
		return el.querySelector('img');
	}

	/**
	 * An image file's name without its folder, extension or WordPress's own
	 * suffixes (-scaled, -1024x768): .../uploads/2026/10/studio-tags-photo.jpg
	 * -> studio-tags-photo. Empty when it is not a plain file name.
	 */
	function fileStemOf(src) {
		var path = String(src || '').split(/[?#]/)[0];
		var name = path.slice(path.lastIndexOf('/') + 1);
		try { name = decodeURIComponent(name); } catch (e) { /* keep it as it is */ }
		var stem = name.replace(/\.[a-z0-9]+$/i, '').replace(/-scaled$/i, '').replace(/-\d+x\d+$/, '').toLowerCase();
		return /^[a-z0-9][a-z0-9-]*$/.test(stem) ? stem : '';
	}

	/**
	 * The picture a slot paints from CSS (a header or section background):
	 * the first url() of its computed background-image, on this site only.
	 */
	function backgroundSrcOf(el) {
		var bg = '';
		try { bg = window.getComputedStyle(el).backgroundImage || ''; } catch (e) { return ''; }
		var m = /url\(\s*["']?([^"')]+)["']?\s*\)/.exec(bg);
		if (!m) return '';
		try {
			var u = new URL(m[1], document.baseURI);
			return u.origin === window.location.origin ? u.href : '';
		} catch (e2) {
			return '';
		}
	}

	function buildBindings() {
		bindings = [];
		bindingsByEl = new Map();
		hoveredBinding = null;
		var i, el;

		// The header and the footer.
		var chromes = document.querySelectorAll('[data-wm-chrome]');
		if (chromes.length) {
			for (i = 0; i < chromes.length; i++) {
				el = chromes[i];
				var region = el.getAttribute('data-wm-chrome') === 'footer' ? 'footer' : 'header';
				addBinding('chrome', region, el, { region: region, label: region === 'footer' ? 'Footer' : 'Header' });
			}
		} else {
			var headers = Array.prototype.filter.call(document.querySelectorAll('header'), function (h) { return !hasSectionAncestor(h) && !h.closest('main, article'); });
			var footers = Array.prototype.filter.call(document.querySelectorAll('footer'), function (f) { return !hasSectionAncestor(f) && !f.closest('main, article'); });
			if (headers.length) addBinding('chrome', 'header', headers[0], { region: 'header', label: 'Header' });
			if (footers.length) addBinding('chrome', 'footer', footers[footers.length - 1], { region: 'footer', label: 'Footer' });
		}

		// Sections (data-wm-section; before it, section[id] in the page).
		var fallback = false;
		var sections = Array.prototype.slice.call(document.querySelectorAll('[data-wm-section]'));
		var outline = [];
		// A site WPMaven did not design: the page's top-level blocks are its sections
		// (named the way the edit engine names them: b<index>-<mark>), its pictures their images.
		// A wrapper block (a group) carries no mark of its own: its element is the outermost
		// one holding its blocks and no block of another section.
		// A page built with Elementor: its top-level elements are its sections (el-<id>, the
		// edit engine's names), its image widgets their pictures. Its layout stays Elementor's.
		var elementorPost = !sections.length ? String(detectPagePostId() || '') : '';
		var elementorRoot = elementorPost ? document.querySelector('[data-elementor-id="' + elementorPost + '"]') : null;
		if (elementorRoot) {
			var etops = Array.prototype.filter.call(elementorRoot.querySelectorAll('[data-element_type][data-id]'), function (n) {
				var up = n.parentElement ? n.parentElement.closest('[data-element_type][data-id]') : null;
				return !up || !elementorRoot.contains(up);
			});
			for (i = 0; i < etops.length; i++) {
				el = etops[i];
				if (!visible(el)) continue;
				var eid = el.getAttribute('data-id') || '';
				if (!/^[0-9a-z]{1,16}$/i.test(eid)) continue;
				var eheading = el.querySelector('h1, h2, h3, h4');
				var elabel = (eheading && squash(eheading.textContent, 60)) || squash(el.textContent, 40) || 'Section';
				addBinding('section', elementorPost + '#el-' + eid, el, { page: elementorPost, sectionId: 'el-' + eid, label: elabel });
				outline.push({ page: elementorPost, sectionId: 'el-' + eid, label: elabel });
			}
			var eimages = elementorRoot.querySelectorAll('[data-widget_type^="image."][data-id]');
			for (i = 0; i < eimages.length; i++) {
				el = eimages[i];
				if (!visible(el)) continue;
				var eimg = imageOf(el);
				addBinding('image', 'el:' + (el.getAttribute('data-id') || ''), el, {
					slot: el.getAttribute('data-id') || '',
					label: 'Image',
					src: eimg ? (eimg.currentSrc || eimg.getAttribute('src') || '') : '',
					alt: eimg ? (eimg.getAttribute('alt') || '') : '',
				});
			}
			sections = [];
		} else if (!sections.length && document.querySelector('[data-wme-owner^="post:"][data-wme-block-uid]')) {
			var pagePost = String(detectPagePostId() || '');
			var marked = Array.prototype.filter.call(document.querySelectorAll('[data-wme-owner^="post:"][data-wme-block-uid]'), function (m) {
				var owner = (m.getAttribute('data-wme-owner') || '').replace(/^post:/, '');
				return /^\d+$/.test(owner) && (!pagePost || owner === pagePost) && /^\d+(\.\d+)*$/.test(m.getAttribute('data-wme-block-uid') || '');
			});
			var topOf = function (m) { return (m.getAttribute('data-wme-block-uid') || '').split('.')[0]; };
			var byTop = {};
			var tops = [];
			for (i = 0; i < marked.length; i++) {
				var t = topOf(marked[i]);
				if (!byTop[t]) { byTop[t] = []; tops.push(t); }
				byTop[t].push(marked[i]);
			}
			for (i = 0; i < tops.length; i++) {
				var top = tops[i];
				var first = byTop[top][0];
				var ownerPost = (first.getAttribute('data-wme-owner') || '').replace(/^post:/, '');
				var own = byTop[top].filter(function (m) { return m.getAttribute('data-wme-block-uid') === top; })[0];
				var cur = own || first;
				while (cur.parentElement && cur.parentElement !== document.body) {
					var up = cur.parentElement;
					var inside = up.querySelectorAll('[data-wme-owner="post:' + ownerPost + '"][data-wme-block-uid]');
					var foreign = false;
					for (var q = 0; q < inside.length; q++) {
						if (topOf(inside[q]) !== top) { foreign = true; break; }
					}
					if (foreign) break;
					cur = up;
				}
				if (!visible(cur)) continue;
				var bsig = own ? (own.getAttribute('data-wme-block-sig') || '') : '';
				var bname = own ? (own.getAttribute('data-wme-block-name') || '') : '';
				var bheading = /^core\/heading$/.test(bname) ? own : cur.querySelector('h1, h2, h3, h4');
				var blabel = (bheading && squash(bheading.textContent, 60)) || humanize(bname.replace(/^core\//, '')) || 'Section';
				var bsection = 'b' + top + (bsig ? '-' + bsig.slice(0, 8) : '');
				addBinding('section', ownerPost + '#' + bsection, cur, { page: ownerPost, sectionId: bsection, blockIndex: parseInt(top, 10), label: blabel });
				outline.push({ page: ownerPost, sectionId: bsection, blockIndex: parseInt(top, 10), label: blabel });
			}
			for (i = 0; i < marked.length; i++) {
				el = marked[i];
				var iname = el.getAttribute('data-wme-block-name') || '';
				if (!/^core\/(image|cover|media-text)$/.test(iname) || !visible(el)) continue;
				var iuid = el.getAttribute('data-wme-block-uid') || '';
				var bimg = imageOf(el);
				addBinding('image', (el.getAttribute('data-wme-owner') || '') + '#' + iuid, el, {
					slot: iuid.replace(/\./g, '-'),
					label: 'Image',
					src: bimg ? (bimg.currentSrc || bimg.getAttribute('src') || '') : backgroundSrcOf(el),
					alt: bimg ? (bimg.getAttribute('alt') || '') : '',
				});
			}
			sections = [];
		} else if (!sections.length) {
			fallback = true;
			sections = Array.prototype.filter.call(document.querySelectorAll('section[id]'), function (s) {
				return !hasSectionAncestor(s) && !s.closest('header, footer, [data-wm-chrome]');
			});
		}
		for (i = 0; i < sections.length; i++) {
			el = sections[i];
			if (!visible(el)) continue;
			var sectionId = el.getAttribute('data-wm-section') || el.id;
			if (!sectionId) continue;
			var page = pageOf(el);
			var heading = el.querySelector('h1, h2, h3');
			var label = (heading && squash(heading.textContent, 60)) || humanize(sectionId);
			addBinding('section', page + '#' + sectionId, el, {
				page: page,
				sectionId: sectionId,
				template: el.getAttribute('data-wm-template') || '',
				label: label,
			});
			outline.push({ page: page, sectionId: sectionId, label: label });
		}
		// A designed page with blocks the owner added in WordPress between its sections:
		// each such top-level block is a section of its own, named as on a block page
		// (b<index>-<mark>), listed where it sits on the page.
		if (sections.length && !fallback) {
			var designedPost = String(detectPagePostId() || '');
			var owned = document.querySelectorAll('[data-wme-owner^="post:"][data-wme-block-uid]');
			var addedOwn = false;
			for (i = 0; i < owned.length; i++) {
				el = owned[i];
				var ouid = el.getAttribute('data-wme-block-uid') || '';
				var opost = (el.getAttribute('data-wme-owner') || '').replace(/^post:/, '');
				if (!/^\d+$/.test(ouid) || (designedPost && opost !== designedPost)) continue;
				if (el.hasAttribute('data-wme-designed') || el.hasAttribute('data-wm-page') || el.closest('[data-wm-section]') || !visible(el)) continue;
				var oname = el.getAttribute('data-wme-block-name') || '';
				var oheading = /^H[1-6]$/.test(el.tagName) ? el : el.querySelector('h1, h2, h3, h4');
				var olabel = (oheading && squash(oheading.textContent, 60)) || squash(el.textContent, 40) || humanize(oname.replace(/^core\//, '')) || 'Section';
				var osig = (el.getAttribute('data-wme-block-sig') || '').slice(0, 8);
				var osection = 'b' + ouid + (osig ? '-' + osig : '');
				var opage = pageOf(el);
				addBinding('section', opage + '#' + osection, el, { page: opage, sectionId: osection, blockIndex: parseInt(ouid, 10), label: olabel });
				addedOwn = true;
			}
			if (addedOwn) {
				outline = bindings.filter(function (b) { return b.kind === 'section'; }).sort(function (a, b) {
					return a.el === b.el ? 0 : (a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
				}).map(function (b) {
					var o = { page: b.page, sectionId: b.sectionId, label: b.label };
					if (typeof b.blockIndex === 'number') o.blockIndex = b.blockIndex;
					return o;
				});
			}
		}

		// Product and post cards (their own forms).
		var products = document.querySelectorAll('[data-wm-product]');
		for (i = 0; i < products.length; i++) {
			el = products[i];
			var slug = el.getAttribute('data-wm-product') || '';
			if (!slug || slug.indexOf('%%') !== -1 || !visible(el)) continue;
			var nameEl = el.querySelector('[data-wm-field="name"]');
			addBinding('product', slug, el, {
				productSlug: slug,
				productId: productIdFor(el, slug) || undefined,
				label: squash(nameEl ? nameEl.textContent : (window.wmWp && window.wmWp.products && window.wmWp.products[slug] && window.wmWp.products[slug].name) || humanize(slug), 60),
			});
		}
		var posts = document.querySelectorAll('[data-wm-post]');
		for (i = 0; i < posts.length; i++) {
			el = posts[i];
			var postId = parseInt(el.getAttribute('data-wm-post') || '', 10);
			if (!(postId > 0) || !visible(el)) continue;
			var titleEl = el.querySelector('[data-wm-field="title"], h1, h2, h3');
			addBinding('post', String(postId), el, { postId: postId, label: squash(titleEl ? titleEl.textContent : '', 60) || 'Post' });
		}

		// Social links: the designed icons (data-wm-social), the social menu's items and
		// links marked as the business's social profile open the Social links panel.
		var socials = document.querySelectorAll('[data-wm-social], [data-wm-menu^="social"] [data-wm-menu-item], [data-wm-menu-item][data-wm-menu^="social"], a[data-content="biz:social"]');
		for (i = 0; i < socials.length; i++) {
			el = socials[i];
			if (!visible(el)) continue;
			var network = el.getAttribute('data-wm-social') || '';
			addBinding('social', (network || 'link') + '#' + i, el, { network: network, label: 'Social links' });
		}
		// Menu items, facts and images: reached from what holds them.
		var items = document.querySelectorAll('[data-wm-menu-item]');
		for (i = 0; i < items.length; i++) {
			el = items[i];
			var itemId = parseInt(el.getAttribute('data-wm-menu-item') || '', 10);
			if (!(itemId > 0) || !visible(el)) continue;
			var location = el.getAttribute('data-wm-menu') || '';
			if (/^social/.test(location)) continue;
			addBinding('menu-item', location + '#' + itemId, el, { location: location, itemId: itemId, label: squash(el.textContent, 60) || 'Menu item' });
		}
		var facts = document.querySelectorAll('[data-content^="var:"], [data-content^="biz:"]');
		for (i = 0; i < facts.length; i++) {
			el = facts[i];
			var key = (el.getAttribute('data-content') || '').replace(/^(var|biz):/, '');
			if (!key || key === 'social' || !visible(el)) continue;
			addBinding('fact', key, el, { factKey: key, label: humanize(key) });
		}
		// Designed forms: their WordPress name, baked on the live page.
		var forms = document.querySelectorAll('[data-wm-form]');
		for (i = 0; i < forms.length; i++) {
			el = forms[i];
			var formName = el.getAttribute('data-wm-form') || '';
			if (!/^[a-z0-9][a-z0-9_-]*$/i.test(formName) || !visible(el)) continue;
			var intent = (/-(newsletter|contact|booking|quote|feedback|order)(?:-inferred)?(?:-\d+)?$/.exec(formName) || [])[1] || 'contact';
			addBinding('form', formName, el, { formName: formName, label: FORM_WORDS[intent] || 'Form' });
		}
		var slots = document.querySelectorAll('[data-slot]');
		for (i = 0; i < slots.length; i++) {
			el = slots[i];
			var slot = el.getAttribute('data-slot') || '';
			if (!slot || !visible(el) || el.closest('[data-wm-product], [data-wm-post]')) continue;
			var img = imageOf(el);
			addBinding('image', slot, el, {
				slot: slot,
				label: slot === 'logo' ? 'Logo' : 'Image',
				src: img ? (img.currentSrc || img.getAttribute('src') || '') : backgroundSrcOf(el),
				alt: img ? (img.getAttribute('alt') || '') : (el.getAttribute('aria-label') || ''),
			});
		}

		// Images with no slot (2026-10-17: every picture of About, Contact and
		// the privacy page, which reuse the home page's files): addressed by
		// their file's name, as the engine reads an image slot it does not find
		// (its file name stem). Only inside a section, never inside a product or
		// post card, and never one a slot already holds.
		var loose = document.querySelectorAll('[data-wm-section] img:not([data-slot])');
		for (i = 0; i < loose.length; i++) {
			el = loose[i];
			if (!visible(el) || el.closest('[data-slot], [data-wm-product], [data-wm-post]')) continue;
			var looseSrc = el.currentSrc || el.getAttribute('src') || '';
			var stem = fileStemOf(looseSrc);
			if (!stem) continue;
			addBinding('image', 'file:' + stem, el, { slot: stem, label: 'Image', src: looseSrc, alt: el.getAttribute('alt') || '' });
		}

		notifyParent('wme:bindings-ready', {
			count: bindings.length,
			page: pageHint || (outline[0] ? outline[0].page : ''),
			postId: detectPagePostId(),
			sections: outline,
			fallback: fallback,
		});
	}

	/** The bindings holding a node, innermost first. */
	function chainOf(node) {
		var chain = [];
		var cur = node && node.nodeType === 1 ? node : (node ? node.parentElement : null);
		while (cur && cur !== document.documentElement) {
			var list = bindingsByEl.get(cur);
			if (list) {
				for (var i = 0; i < list.length; i++) chain.push(list[i]);
			}
			cur = cur.parentElement;
		}
		return chain;
	}

	function bindingByUid(uid) {
		if (!uid) return null;
		for (var i = 0; i < bindings.length; i++) {
			if (bindings[i].uid === uid) return bindings[i];
		}
		return null;
	}

	/** The section, header or footer a binding sits in (itself for a container). */
	function containerOf(b) {
		if (CONTAINERS[b.kind]) return b;
		var chain = chainOf(b.el.parentElement);
		var found = null;
		for (var i = 0; i < chain.length; i++) {
			if (CONTAINERS[chain[i].kind]) found = chain[i];
		}
		return found;
	}

	/** What a click on this node selects (see the rules above). */
	function pickBinding(node, outward) {
		var chain = chainOf(node);
		if (!chain.length) return null;
		var container = null;
		var object = null;
		for (var i = 0; i < chain.length; i++) {
			if (!object && OBJECTS[chain[i].kind]) object = chain[i];
			if (CONTAINERS[chain[i].kind]) container = chain[i];
		}
		if (outward) return container || chain[chain.length - 1];
		if (object) return object;
		var selected = bindingByUid(selectedBinding);
		var scope = selected ? (CONTAINERS[selected.kind] ? selected : (DRILLS[selected.kind] ? containerOf(selected) : null)) : null;
		if (scope && chain.indexOf(scope) !== -1) {
			for (var j = 0; j < chain.length; j++) {
				if (chain[j] === scope) break;
				if (DRILLS[chain[j].kind]) return chain[j];
			}
			return scope;
		}
		if (container) return container;
		for (var k = 0; k < chain.length; k++) {
			if (DRILLS[chain[k].kind]) return chain[k];
		}
		return chain[chain.length - 1];
	}

	var ADDRESS_KEYS = ['page', 'sectionId', 'template', 'region', 'productSlug', 'productId', 'postId', 'location', 'itemId', 'factKey', 'slot', 'formName', 'blockIndex'];

	function describe(b, full) {
		var out = { uid: b.uid, kind: b.kind, label: b.label || '', rect: rectToObj(getElementRect(b.el)), binding: { kind: b.kind } };
		for (var i = 0; i < ADDRESS_KEYS.length; i++) {
			if (b[ADDRESS_KEYS[i]] !== undefined) out.binding[ADDRESS_KEYS[i]] = b[ADDRESS_KEYS[i]];
		}
		if (!full) return out;
		out.excerpt = squash(b.el.textContent, 500);
		var c = containerOf(b);
		if (c && c !== b) {
			out.container = { kind: c.kind, label: c.label || '' };
			for (var j = 0; j < ADDRESS_KEYS.length; j++) {
				if (c[ADDRESS_KEYS[j]] !== undefined) out.container[ADDRESS_KEYS[j]] = c[ADDRESS_KEYS[j]];
			}
		}
		if (b.kind === 'image') {
			out.src = b.src || '';
			out.alt = b.alt || '';
		}
		if (b.kind === 'fact') out.value = squash(b.el.textContent, 300);
		if (CONTAINERS[b.kind]) {
			// What a second click reaches in it, for the panel's list.
			out.inside = [];
			for (var k = 0; k < bindings.length && out.inside.length < 16; k++) {
				var inner = bindings[k];
				if (inner === b || !(DRILLS[inner.kind] || OBJECTS[inner.kind]) || !b.el.contains(inner.el)) continue;
				out.inside.push({ uid: inner.uid, kind: inner.kind, label: inner.label || '' });
			}
		}
		return out;
	}

	function onBindingHover(e) {
		var target = pickBinding(e.target, e.altKey);
		if (target === hoveredBinding) return;
		hoveredBinding = target;
		if (target) {
			notifyParent('wme:binding-hover', describe(target, false));
		} else {
			notifyParent('wme:binding-hover-out', {});
		}
	}

	/** A control of the page itself (a menu toggle, an accordion) inside what is already selected. */
	function isPageControl(node) {
		var el = node && node.nodeType === 1 ? node : (node ? node.parentElement : null);
		if (!el || !el.closest) return false;
		if (el.closest('a[href]')) return false;
		return !!el.closest('button, summary, label, [role="button"], [aria-controls], [aria-expanded], input, select, textarea');
	}

	function onBindingClick(e) {
		// Nothing navigates or submits in the editor.
		var link = e.target.closest ? e.target.closest('a[href]') : null;
		if (link) {
			e.preventDefault();
		}
		var tag = e.target.tagName;
		if (tag === 'VIDEO' || tag === 'AUDIO') return;
		var target = pickBinding(e.target, e.altKey);
		if (!target) {
			if (link) e.stopPropagation();
			return;
		}
		// A second click on a menu toggle or an accordion of the selected part works as on the site.
		if (target.uid === selectedBinding && !link && isPageControl(e.target)) return;
		e.preventDefault();
		e.stopPropagation();
		selectedBinding = target.uid;
		notifyParent('wme:select-binding', describe(target, true));
	}

	function sendBindingPositions() {
		var positions = {};
		if (hoveredBinding && hoveredBinding.el.isConnected) positions[hoveredBinding.uid] = rectToObj(getElementRect(hoveredBinding.el));
		var sel = bindingByUid(selectedBinding);
		if (sel && sel.el.isConnected) positions[sel.uid] = rectToObj(getElementRect(sel.el));
		notifyParent('wme:binding-positions', positions);
	}

	/** Find a binding by its address and select it (or only outline it, quiet). */
	function selectAddress(address, quiet) {
		if (address.uid && bindingByUid(address.uid)) {
			return reveal(bindingByUid(address.uid), quiet);
		}
		var match = null;
		for (var i = 0; i < bindings.length && !match; i++) {
			var b = bindings[i];
			if (address.kind && b.kind !== address.kind) continue;
			var same = true;
			for (var j = 0; j < ADDRESS_KEYS.length; j++) {
				var k = ADDRESS_KEYS[j];
				if (address[k] === undefined || address[k] === null || address[k] === '' || k === 'page' && !b.page) continue;
				if (String(b[k]) !== String(address[k])) { same = false; break; }
			}
			if (same) match = b;
		}
		// A page of WordPress blocks: the site map names a section b<index>-<mark>, the page marks
		// its blocks only (a wrapper group has no mark of its own): the section of that top-level block.
		var top = !match && address.kind === 'section' ? /^b(\d+)(?:-|$)/.exec(String(address.sectionId || '')) : null;
		for (var t = 0; top && t < bindings.length && !match; t++) {
			var tb = bindings[t];
			if (tb.kind === 'section' && tb.blockIndex === parseInt(top[1], 10) && (!address.page || !tb.page || String(tb.page) === String(address.page))) match = tb;
		}
		if (!match) {
			notifyParent('wme:binding-missing', { address: address });
			return;
		}
		reveal(match, quiet);
	}

	function reveal(b, quiet) {
		selectedBinding = b.uid;
		if (typeof b.el.scrollIntoView === 'function') {
			try {
				b.el.scrollIntoView({ block: 'center', behavior: quiet ? 'auto' : 'smooth' });
			} catch (err) {
				try { b.el.scrollIntoView(); } catch (ignored) { /* the page keeps its scroll */ }
			}
		}
		setTimeout(function () {
			notifyParent(quiet ? 'wme:binding-highlighted' : 'wme:select-binding', describe(b, true));
		}, quiet ? 50 : 350);
	}

	/** The Design panel's colors and fonts, live (CSS variables of the design system only). */
	function setTokens(vars) {
		var root = document.documentElement;
		for (var name in vars) {
			if (!Object.prototype.hasOwnProperty.call(vars, name) || !/^--ds-[a-z0-9-]{1,40}$/.test(name)) continue;
			var value = String(vars[name] || '');
			if (!/^#[0-9a-fA-F]{6}$/.test(value) && !/^'[A-Za-z0-9 .-]{1,60}'(, [a-z-]{1,20})?$/.test(value)) continue;
			if (!Object.prototype.hasOwnProperty.call(tokenBackup, name)) tokenBackup[name] = root.style.getPropertyValue(name);
			root.style.setProperty(name, value);
		}
	}

	function resetTokens() {
		var root = document.documentElement;
		for (var name in tokenBackup) {
			if (!Object.prototype.hasOwnProperty.call(tokenBackup, name)) continue;
			if (tokenBackup[name]) root.style.setProperty(name, tokenBackup[name]);
			else root.style.removeProperty(name);
		}
		tokenBackup = {};
	}

	/** A font's stylesheet for a live look (Google Fonts or Fontshare only). */
	function loadFont(href) {
		if (typeof href !== 'string' || !/^https:\/\/(fonts\.googleapis\.com\/css2\?|api\.fontshare\.com\/v2\/css\?)[\w%=&;:@.+,[\]-]{1,300}$/.test(href)) return;
		var links = document.querySelectorAll('link[data-wme-font]');
		for (var i = 0; i < links.length; i++) {
			if (links[i].getAttribute('href') === href) return;
		}
		var link = document.createElement('link');
		link.rel = 'stylesheet';
		link.href = href;
		link.setAttribute('data-wme-font', '1');
		document.head.appendChild(link);
	}

	// Block form submissions in the editor (bindings mode as well).
	document.addEventListener('submit', function (e) {
		if (mode === 'bindings') e.preventDefault();
	}, true);

	// ── Parent Communication ───────────────────────────────────────────

	// Use same origin for security — both iframe and parent are served by WordPress.
	var parentOrigin = window.location.origin;

	function notifyParent(type, payload) {
		window.parent.postMessage({ type: type, payload: payload }, parentOrigin);
	}

	window.addEventListener('message', function (e) { // nosemgrep: javascript.browser.security.insufficient-postmessage-origin-validation.insufficient-postmessage-origin-validation (the origin is checked on the next line: the editor is this site's own origin)
		// Only accept messages from our own origin.
		if (e.origin !== parentOrigin) return;
		if (!e.data || !e.data.type) return;

		switch (e.data.type) {
			case 'wme:request-map': {
				var asked = e.data.payload || {};
				mode = 'legacy';
				holdPage();
				withBindings = !!asked.bindings;
				pageHint = typeof asked.page === 'string' ? asked.page : '';
				// The same page in the other editor (a crossing): the part the owner crossed from is selected again.
				if (typeof asked.reselect === 'string') {
					var from = elementMap.get(asked.reselect);
					if (from) crossNode = from.el;
				}
				viewMode = asked.mode === 'template' ? 'template' : '';
				hoveredEntry = null;
				buildElementMap();
				if (withBindings) buildBindings();
				if (asked.reselect && crossNode) {
					var again = entryFor(crossNode);
					if (again) selectEntry(again);
				}
				crossNode = null;
				break;
			}

			case 'wme:request-bindings':
				mode = 'bindings';
				holdPage();
				pageHint = (e.data.payload && typeof e.data.payload.page === 'string') ? e.data.payload.page : '';
				buildBindings();
				break;

			case 'wme:select-address':
				selectAddress(e.data.payload || {}, false);
				break;

			case 'wme:highlight':
				selectAddress(e.data.payload || {}, true);
				break;

			case 'wme:clear-selection':
				selectedBinding = null;
				break;

			case 'wme:set-tokens':
				setTokens((e.data.payload && e.data.payload.vars) || {});
				break;

			case 'wme:reset-tokens':
				resetTokens();
				break;

			case 'wme:load-font':
				loadFont(e.data.payload && e.data.payload.href);
				break;

			case 'wme:select-element': {
				var chosen = e.data.payload && e.data.payload.uid ? elementMap.get(String(e.data.payload.uid)) : null;
				// A change's badge opens its part: brought into view first when it was scrolled away.
				if (chosen && e.data.payload.reveal) {
					var cr = chosen.el.getBoundingClientRect();
					if (cr.bottom < 0 || cr.top > window.innerHeight) chosen.el.scrollIntoView({ block: 'center' });
				}
				if (chosen) selectEntry(chosen);
				break;
			}

			case 'wme:jobs':
				busyUids = (e.data.payload && e.data.payload.busy) || [];
				followUids = (e.data.payload && e.data.payload.follow) || [];
				break;

			case 'wme:locate': {
				// The window's changes on this page, after it loaded again: each part by its uid while its words
				// still match, else the first part with the same words; none when the page no longer has it.
				var asked = (e.data.payload && e.data.payload.items) || [];
				var found = [];
				for (var li = 0; li < asked.length; li++) {
					var want = String(asked[li].words || '').replace(/\s+/g, ' ').trim();
					var same = function (en) { return !want || wordsOf(en.el).replace(/\s+/g, ' ').trim().slice(0, want.length) === want; };
					var aid = String(asked[li].uid || '');
					// A section by its binding (its id is the section's own).
					var bel = aid.indexOf('binding:') === 0 ? partEl(aid) : null;
					if (bel) { found.push({ id: asked[li].id, uid: aid, rect: rectToObj(getElementRect(bel)), look: lookOf(bel) }); continue; }
					var hit = elementMap.get(aid);
					if (hit && !same(hit)) hit = null;
					if (!hit && want) elementMap.forEach(function (en) { if (!hit && same(en)) hit = en; });
					found.push(hit ? { id: asked[li].id, uid: hit.blockUid, rect: rectToObj(getElementRect(hit.el)), look: lookOf(hit.el) } : { id: asked[li].id, uid: null });
				}
				notifyParent('wme:located', { items: found });
				break;
			}

			case 'wme:enable-editing':
				enableEditing(e.data.payload.uid);
				break;

			case 'wme:disable-editing':
				disableEditing(false);
				break;

			case 'wme:cancel-editing':
				cancelEditing();
				break;

			case 'wme:replay-previews':
				// Batch re-apply DOM previews (e.g. after iframe reload).
				var list = e.data.payload.changes || [];
				for (var ri = 0; ri < list.length; ri++) {
					applyPreview(list[ri].uid, list[ri].content);
				}
				break;

			case 'wme:capture-original':
				// Capture current innerHTML as the "original" for discard,
				// used after inline contenteditable edits (which bypass applyPreview).
				var capUid = e.data.payload.uid;
				var capEntry = elementMap.get(capUid);
				if (capEntry && !originalContent.has(capUid)) {
					originalContent.set(capUid, capEntry.el.innerHTML);
				}
				break;

			case 'wme:apply-preview':
				applyPreview(e.data.payload.uid, e.data.payload.content);
				break;

			case 'wme:discard-preview':
				discardPreview(e.data.payload.uid);
				break;

			case 'wme:get-positions':
				updateAndSendPositions();
				break;
		}
	});

	// ── Observers ──────────────────────────────────────────────────────

	/** The map built again, once the page rests. */
	function scheduleRebuild() {
		clearTimeout(rebuildTimer);
		rebuildTimer = setTimeout(function () {
			if (mode === 'bindings') {
				buildBindings();
				return;
			}
			hoveredEntry = null; // Reset stale reference.
			buildElementMap();
			if (withBindings) buildBindings();
		}, 200);
	}

	// Debounced rebuild on DOM changes (lazy-loaded content, etc.).
	var mutationObserver = new MutationObserver(function () {
		if (suppressObserver || mode === null) return;
		scheduleRebuild();
	});
	mutationObserver.observe(document.body, {
		childList: true,
		subtree: true,
	});

	/**
	 * A part left out while it could not be seen (a section revealed on
	 * scroll, WooCommerce's gallery fading in) becomes one once it shows: the
	 * map is built again, as after a change of the page (2026-10-19).
	 */
	function onShown(e) {
		if (mode === null || suppressObserver || !unseenParts.length) return;
		if (e.type === 'transitionend' && e.propertyName !== 'opacity' && e.propertyName !== 'visibility') return;
		var t = e.target;
		if (!t || t.nodeType !== 1) return;
		// The editor's own dims fading in or out are not the page showing something.
		if (t.closest('[data-wme-dim]')) return;
		var faded = new Map();
		for (var i = 0; i < unseenParts.length; i++) {
			// Rebuilt only once the part can be seen: a part that stays hidden (a form's
			// hidden field, an empty picture's placeholder) never starts a rebuild.
			if ((t === unseenParts[i] || t.contains(unseenParts[i])) && !unseen(unseenParts[i], faded)) {
				scheduleRebuild();
				return;
			}
		}
	}
	document.addEventListener('transitionend', onShown, true);
	document.addEventListener('animationend', onShown, true);

	// Another page opens in the frame: the pointer left this one's parts, so their outline goes (2026-10-19).
	window.addEventListener('pagehide', function () {
		if (mode === null) return;
		hoveredEntry = null;
		notifyParent('wme:hover-out', {});
		if (mode === 'bindings') notifyParent('wme:binding-hover-out', {});
	});

	// Update positions on resize.
	var resizeObserver = new ResizeObserver(function () {
		updateAndSendPositions();
	});
	resizeObserver.observe(document.documentElement);

	// Update positions on scroll — use capture on document to catch
	// scrollable containers (body, html, inner divs), not just window.
	var scrollTimer = null;
	function onScroll() {
		if (scrollTimer) return;
		scrollTimer = requestAnimationFrame(function () {
			scrollTimer = null;
			updateAndSendPositions();
		});
	}
	window.addEventListener('scroll', onScroll, { passive: true });
	document.addEventListener('scroll', onScroll, { passive: true, capture: true });

	// ── Initialize ─────────────────────────────────────────────────────

	function initialize() {
		// Signal readiness: the parent answers wme:request-map (the element
		// map) or wme:request-bindings (a site WPMaven built). It reads the
		// page from what is sent here.
		notifyParent('wme:discovery-ready', {
			postId: detectPagePostId(),
			isFront: !!(document.body && /\bhome\b/.test(document.body.className)),
			hasBindings: !!document.querySelector('[data-wm-section], [data-wm-chrome], [data-wm-page]'),
			url: window.location.href,
			title: document.title,
		});
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', initialize);
	} else {
		initialize();
	}
})();
