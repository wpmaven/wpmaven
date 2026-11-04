/**
 * Each network's logo, brand colour and name, as the dashboard's Connect
 * cards draw them (its connect/channelGuides): the chips and the network
 * notes on an approval card show the logo the owner knows the account by,
 * in the plugin too.
 *
 * Brand colour, or var(--text) for the logos that are a single black glyph,
 * which would disappear against the dark theme in their real colour.
 */
import type { IconType } from 'react-icons';
import {
  SiFacebook, SiGooglemaps, SiInstagram, SiPinterest, SiTiktok, SiWhatsapp, SiX, SiYoutube,
} from 'react-icons/si';
import { FaLinkedin } from 'react-icons/fa6';

export interface NetworkLook {
  /** The name the owner would use. */
  name: string;
  Icon: IconType;
  color: string;
}

export const NETWORK_LOOKS: Readonly<Record<string, NetworkLook>> = {
  twitter: { name: 'X', Icon: SiX, color: 'var(--text)' },
  linkedin: { name: 'LinkedIn', Icon: FaLinkedin, color: '#0A66C2' },
  pinterest: { name: 'Pinterest', Icon: SiPinterest, color: '#E60023' },
  tiktok: { name: 'TikTok', Icon: SiTiktok, color: 'var(--text)' },
  youtube: { name: 'YouTube', Icon: SiYoutube, color: '#FF0000' },
  facebook: { name: 'Facebook Page', Icon: SiFacebook, color: '#1877F2' },
  instagram: { name: 'Instagram', Icon: SiInstagram, color: '#E4405F' },
  gmb: { name: 'Google Business Profile', Icon: SiGooglemaps, color: '#4285F4' },
  whatsapp: { name: 'WhatsApp', Icon: SiWhatsapp, color: '#25D366' },
};
