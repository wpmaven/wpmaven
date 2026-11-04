export interface WPPost {
  id: number;
  title: { rendered: string };
  status: 'publish' | 'draft' | 'pending' | 'private' | 'trash';
  date: string;
  modified: string;
  slug: string;
  link: string;
  author: number;
  _embedded?: {
    author?: Array<{ name: string }>;
  };
}

export interface WPPage {
  id: number;
  title: { rendered: string };
  status: 'publish' | 'draft' | 'pending' | 'private' | 'trash';
  date: string;
  modified: string;
  slug: string;
  link: string;
  template: string;
  author: number;
  _embedded?: {
    author?: Array<{ name: string }>;
  };
}

export interface WPComment {
  id: number;
  post: number;
  author_name: string;
  author_email: string;
  content: { rendered: string };
  date: string;
  status: 'approved' | 'hold' | 'spam' | 'trash';
  _links?: {
    up?: Array<{ href: string }>;
  };
}

export interface WPPlugin {
  plugin: string; // e.g. "akismet/akismet.php"
  name: string;
  description: { raw: string; rendered: string };
  version: string;
  status: 'active' | 'inactive';
  author: string;
}

export interface WPUser {
  id: number;
  username: string;
  name: string;
  email?: string;
  roles: string[];
  slug: string;
  link: string;
  avatar_urls?: Record<string, string>;
}

export interface WPTheme {
  stylesheet: string;
  name: { rendered?: string; raw?: string } | string;
  version: string;
  status: 'active' | 'inactive';
  screenshot?: string;
  description?: { raw?: string; rendered?: string } | string;
  author?: { raw?: string; rendered?: string } | string;
  template?: string;
  webmavenGenerated?: boolean;
}

export interface WPMedia {
  id: number;
  title: { rendered: string };
  date: string;
  modified: string;
  slug: string;
  link: string;
  mime_type: string;
  media_type: 'image' | 'file' | 'audio' | 'video';
  source_url: string;
  media_details?: {
    width?: number;
    height?: number;
    file?: string;
    filesize?: number;
    sizes?: Record<string, { source_url: string; width: number; height: number }>;
  };
  alt_text?: string;
  caption?: { rendered: string };
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  totalPages: number;
}
