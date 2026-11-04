/**
 * Every country a WhatsApp number can come from: the 245 regions of
 * libphonenumber-js, the phone parser the API reads the number with, so any
 * ISO code here parses there. Alphabetical by English name; the flag comes
 * from the ISO code. `example` is a national-format number for the input's
 * placeholder. `main` marks the country a shared dial code belongs to first
 * (+1 United States, +7 Russia, +44 United Kingdom...), so a number read back
 * from its dial code lands there.
 *
 * Until 2026-10-15 the picker had 46 hand-picked countries, and an
 * owner in Bulgaria could not find theirs. The names and examples of those 46
 * are kept as they were written; the others come from libphonenumber-js's
 * example mobile numbers and the English region names of Intl.DisplayNames.
 */
import { getLanguage, localeTag } from '@yotako/webmaven-ui';

export interface WhatsAppCountry {
  iso: string;
  dial: string;
  name: string;
  example: string;
  main?: true;
}

export const WHATSAPP_COUNTRIES: readonly WhatsAppCountry[] = [
  { iso: 'AF', dial: '+93', name: 'Afghanistan', example: '070 123 4567' },
  { iso: 'AX', dial: '+358', name: 'Åland Islands', example: '041 2345678' },
  { iso: 'AL', dial: '+355', name: 'Albania', example: '067 212 3456' },
  { iso: 'DZ', dial: '+213', name: 'Algeria', example: '0551 23 45 67' },
  { iso: 'AS', dial: '+1', name: 'American Samoa', example: '(684) 733-1234' },
  { iso: 'AD', dial: '+376', name: 'Andorra', example: '312 345' },
  { iso: 'AO', dial: '+244', name: 'Angola', example: '923 123 456' },
  { iso: 'AI', dial: '+1', name: 'Anguilla', example: '(264) 235-1234' },
  { iso: 'AG', dial: '+1', name: 'Antigua and Barbuda', example: '(268) 464-1234' },
  { iso: 'AR', dial: '+54', name: 'Argentina', example: '11 2345-6789' },
  { iso: 'AM', dial: '+374', name: 'Armenia', example: '077 123456' },
  { iso: 'AW', dial: '+297', name: 'Aruba', example: '560 1234' },
  { iso: 'AC', dial: '+247', name: 'Ascension Island', example: '40123' },
  { iso: 'AU', dial: '+61', name: 'Australia', example: '0412 345 678', main: true },
  { iso: 'AT', dial: '+43', name: 'Austria', example: '0664 123456' },
  { iso: 'AZ', dial: '+994', name: 'Azerbaijan', example: '040 123 45 67' },
  { iso: 'BS', dial: '+1', name: 'Bahamas', example: '(242) 359-1234' },
  { iso: 'BH', dial: '+973', name: 'Bahrain', example: '3600 1234' },
  { iso: 'BD', dial: '+880', name: 'Bangladesh', example: '01812-345678' },
  { iso: 'BB', dial: '+1', name: 'Barbados', example: '(246) 250-1234' },
  { iso: 'BY', dial: '+375', name: 'Belarus', example: '8 029 491-19-11' },
  { iso: 'BE', dial: '+32', name: 'Belgium', example: '0470 12 34 56' },
  { iso: 'BZ', dial: '+501', name: 'Belize', example: '622-1234' },
  { iso: 'BJ', dial: '+229', name: 'Benin', example: '01 95 12 34 56' },
  { iso: 'BM', dial: '+1', name: 'Bermuda', example: '(441) 370-1234' },
  { iso: 'BT', dial: '+975', name: 'Bhutan', example: '17 12 34 56' },
  { iso: 'BO', dial: '+591', name: 'Bolivia', example: '71234567' },
  { iso: 'BA', dial: '+387', name: 'Bosnia and Herzegovina', example: '061 123 456' },
  { iso: 'BW', dial: '+267', name: 'Botswana', example: '71 123 456' },
  { iso: 'BR', dial: '+55', name: 'Brazil', example: '(11) 96123-4567' },
  { iso: 'IO', dial: '+246', name: 'British Indian Ocean Territory', example: '380 1234' },
  { iso: 'VG', dial: '+1', name: 'British Virgin Islands', example: '(284) 300-1234' },
  { iso: 'BN', dial: '+673', name: 'Brunei', example: '712 3456' },
  { iso: 'BG', dial: '+359', name: 'Bulgaria', example: '043 012 345' },
  { iso: 'BF', dial: '+226', name: 'Burkina Faso', example: '70 12 34 56' },
  { iso: 'BI', dial: '+257', name: 'Burundi', example: '79 56 12 34' },
  { iso: 'KH', dial: '+855', name: 'Cambodia', example: '091 234 567' },
  { iso: 'CM', dial: '+237', name: 'Cameroon', example: '6 71 23 45 67' },
  { iso: 'CA', dial: '+1', name: 'Canada', example: '(204) 555-0123' },
  { iso: 'CV', dial: '+238', name: 'Cape Verde', example: '991 12 34' },
  { iso: 'BQ', dial: '+599', name: 'Caribbean Netherlands', example: '318 1234' },
  { iso: 'KY', dial: '+1', name: 'Cayman Islands', example: '(345) 323-1234' },
  { iso: 'CF', dial: '+236', name: 'Central African Republic', example: '70 01 23 45' },
  { iso: 'TD', dial: '+235', name: 'Chad', example: '63 01 23 45' },
  { iso: 'CL', dial: '+56', name: 'Chile', example: '9 6123 4567' },
  { iso: 'CN', dial: '+86', name: 'China', example: '131 2345 6789' },
  { iso: 'CX', dial: '+61', name: 'Christmas Island', example: '0412 345 678' },
  { iso: 'CC', dial: '+61', name: 'Cocos (Keeling) Islands', example: '0412 345 678' },
  { iso: 'CO', dial: '+57', name: 'Colombia', example: '321 1234567' },
  { iso: 'KM', dial: '+269', name: 'Comoros', example: '321 23 45' },
  { iso: 'CG', dial: '+242', name: 'Congo (Brazzaville)', example: '06 123 4567' },
  { iso: 'CD', dial: '+243', name: 'Congo (Kinshasa)', example: '0991 234 567' },
  { iso: 'CK', dial: '+682', name: 'Cook Islands', example: '71 234' },
  { iso: 'CR', dial: '+506', name: 'Costa Rica', example: '8312 3456' },
  { iso: 'HR', dial: '+385', name: 'Croatia', example: '092 123 4567' },
  { iso: 'CU', dial: '+53', name: 'Cuba', example: '05 1234567' },
  { iso: 'CW', dial: '+599', name: 'Curaçao', example: '9 518 1234', main: true },
  { iso: 'CY', dial: '+357', name: 'Cyprus', example: '96 123456' },
  { iso: 'CZ', dial: '+420', name: 'Czechia', example: '601 123 456' },
  { iso: 'DK', dial: '+45', name: 'Denmark', example: '32 12 34 56' },
  { iso: 'DJ', dial: '+253', name: 'Djibouti', example: '77 83 10 01' },
  { iso: 'DM', dial: '+1', name: 'Dominica', example: '(767) 225-1234' },
  { iso: 'DO', dial: '+1', name: 'Dominican Republic', example: '(809) 234-5678' },
  { iso: 'EC', dial: '+593', name: 'Ecuador', example: '099 123 4567' },
  { iso: 'EG', dial: '+20', name: 'Egypt', example: '0100 123 4567' },
  { iso: 'SV', dial: '+503', name: 'El Salvador', example: '7012 3456' },
  { iso: 'GQ', dial: '+240', name: 'Equatorial Guinea', example: '222 123 456' },
  { iso: 'ER', dial: '+291', name: 'Eritrea', example: '07 123 456' },
  { iso: 'EE', dial: '+372', name: 'Estonia', example: '5123 4567' },
  { iso: 'SZ', dial: '+268', name: 'Eswatini', example: '7612 3456' },
  { iso: 'ET', dial: '+251', name: 'Ethiopia', example: '091 123 4567' },
  { iso: 'FK', dial: '+500', name: 'Falkland Islands', example: '51234' },
  { iso: 'FO', dial: '+298', name: 'Faroe Islands', example: '21 12 34' },
  { iso: 'FJ', dial: '+679', name: 'Fiji', example: '701 2345' },
  { iso: 'FI', dial: '+358', name: 'Finland', example: '041 2345678', main: true },
  { iso: 'FR', dial: '+33', name: 'France', example: '06 12 34 56 78' },
  { iso: 'GF', dial: '+594', name: 'French Guiana', example: '0694 20 12 34' },
  { iso: 'PF', dial: '+689', name: 'French Polynesia', example: '87 12 34 56' },
  { iso: 'GA', dial: '+241', name: 'Gabon', example: '06 03 12 34' },
  { iso: 'GM', dial: '+220', name: 'Gambia', example: '301 2345' },
  { iso: 'GE', dial: '+995', name: 'Georgia', example: '555 12 34 56' },
  { iso: 'DE', dial: '+49', name: 'Germany', example: '0151 23456789' },
  { iso: 'GH', dial: '+233', name: 'Ghana', example: '023 123 4567' },
  { iso: 'GI', dial: '+350', name: 'Gibraltar', example: '57123456' },
  { iso: 'GR', dial: '+30', name: 'Greece', example: '691 234 5678' },
  { iso: 'GL', dial: '+299', name: 'Greenland', example: '22 12 34' },
  { iso: 'GD', dial: '+1', name: 'Grenada', example: '(473) 403-1234' },
  { iso: 'GP', dial: '+590', name: 'Guadeloupe', example: '0690 00 12 34', main: true },
  { iso: 'GU', dial: '+1', name: 'Guam', example: '(671) 300-1234' },
  { iso: 'GT', dial: '+502', name: 'Guatemala', example: '5123 4567' },
  { iso: 'GG', dial: '+44', name: 'Guernsey', example: '07781 123456' },
  { iso: 'GN', dial: '+224', name: 'Guinea', example: '601 12 34 56' },
  { iso: 'GW', dial: '+245', name: 'Guinea-Bissau', example: '955 012 345' },
  { iso: 'GY', dial: '+592', name: 'Guyana', example: '609 1234' },
  { iso: 'HT', dial: '+509', name: 'Haiti', example: '34 10 1234' },
  { iso: 'HN', dial: '+504', name: 'Honduras', example: '9123-4567' },
  { iso: 'HK', dial: '+852', name: 'Hong Kong SAR China', example: '5123 4567' },
  { iso: 'HU', dial: '+36', name: 'Hungary', example: '06 20 123 4567' },
  { iso: 'IS', dial: '+354', name: 'Iceland', example: '611 1234' },
  { iso: 'IN', dial: '+91', name: 'India', example: '081234 56789' },
  { iso: 'ID', dial: '+62', name: 'Indonesia', example: '0812-345-678' },
  { iso: 'IR', dial: '+98', name: 'Iran', example: '0912 345 6789' },
  { iso: 'IQ', dial: '+964', name: 'Iraq', example: '0791 234 5678' },
  { iso: 'IE', dial: '+353', name: 'Ireland', example: '085 012 3456' },
  { iso: 'IM', dial: '+44', name: 'Isle of Man', example: '07924 123456' },
  { iso: 'IL', dial: '+972', name: 'Israel', example: '050-123-4567' },
  { iso: 'IT', dial: '+39', name: 'Italy', example: '312 345 6789', main: true },
  { iso: 'CI', dial: '+225', name: 'Ivory Coast', example: '01 23 45 6789' },
  { iso: 'JM', dial: '+1', name: 'Jamaica', example: '(876) 210-1234' },
  { iso: 'JP', dial: '+81', name: 'Japan', example: '090-1234-5678' },
  { iso: 'JE', dial: '+44', name: 'Jersey', example: '07797 712345' },
  { iso: 'JO', dial: '+962', name: 'Jordan', example: '07 9012 3456' },
  { iso: 'KZ', dial: '+7', name: 'Kazakhstan', example: '8 (771) 000 9998' },
  { iso: 'KE', dial: '+254', name: 'Kenya', example: '0712 123456' },
  { iso: 'KI', dial: '+686', name: 'Kiribati', example: '72001234' },
  { iso: 'XK', dial: '+383', name: 'Kosovo', example: '043 201 234' },
  { iso: 'KW', dial: '+965', name: 'Kuwait', example: '500 12345' },
  { iso: 'KG', dial: '+996', name: 'Kyrgyzstan', example: '0700 123 456' },
  { iso: 'LA', dial: '+856', name: 'Laos', example: '020 23 123 456' },
  { iso: 'LV', dial: '+371', name: 'Latvia', example: '21 234 567' },
  { iso: 'LB', dial: '+961', name: 'Lebanon', example: '71 123 456' },
  { iso: 'LS', dial: '+266', name: 'Lesotho', example: '5012 3456' },
  { iso: 'LR', dial: '+231', name: 'Liberia', example: '077 012 3456' },
  { iso: 'LY', dial: '+218', name: 'Libya', example: '091-2345678' },
  { iso: 'LI', dial: '+423', name: 'Liechtenstein', example: '660 234 567' },
  { iso: 'LT', dial: '+370', name: 'Lithuania', example: '(0-612) 34567' },
  { iso: 'LU', dial: '+352', name: 'Luxembourg', example: '628 123 456' },
  { iso: 'MO', dial: '+853', name: 'Macao SAR China', example: '6612 3456' },
  { iso: 'MG', dial: '+261', name: 'Madagascar', example: '032 12 345 67' },
  { iso: 'MW', dial: '+265', name: 'Malawi', example: '0991 23 45 67' },
  { iso: 'MY', dial: '+60', name: 'Malaysia', example: '012-345 6789' },
  { iso: 'MV', dial: '+960', name: 'Maldives', example: '771-2345' },
  { iso: 'ML', dial: '+223', name: 'Mali', example: '65 01 23 45' },
  { iso: 'MT', dial: '+356', name: 'Malta', example: '9696 1234' },
  { iso: 'MH', dial: '+692', name: 'Marshall Islands', example: '235-1234' },
  { iso: 'MQ', dial: '+596', name: 'Martinique', example: '0696 20 12 34' },
  { iso: 'MR', dial: '+222', name: 'Mauritania', example: '22 12 34 56' },
  { iso: 'MU', dial: '+230', name: 'Mauritius', example: '5251 2345' },
  { iso: 'YT', dial: '+262', name: 'Mayotte', example: '0639 01 23 45' },
  { iso: 'MX', dial: '+52', name: 'Mexico', example: '222 123 4567' },
  { iso: 'FM', dial: '+691', name: 'Micronesia', example: '350 1234' },
  { iso: 'MD', dial: '+373', name: 'Moldova', example: '0621 12 345' },
  { iso: 'MC', dial: '+377', name: 'Monaco', example: '06 12 34 56 78' },
  { iso: 'MN', dial: '+976', name: 'Mongolia', example: '8812 3456' },
  { iso: 'ME', dial: '+382', name: 'Montenegro', example: '060 123 456' },
  { iso: 'MS', dial: '+1', name: 'Montserrat', example: '(664) 492-3456' },
  { iso: 'MA', dial: '+212', name: 'Morocco', example: '0650 123456', main: true },
  { iso: 'MZ', dial: '+258', name: 'Mozambique', example: '82 123 4567' },
  { iso: 'MM', dial: '+95', name: 'Myanmar (Burma)', example: '09 212 3456' },
  { iso: 'NA', dial: '+264', name: 'Namibia', example: '081 123 4567' },
  { iso: 'NR', dial: '+674', name: 'Nauru', example: '555 1234' },
  { iso: 'NP', dial: '+977', name: 'Nepal', example: '984-1234567' },
  { iso: 'NL', dial: '+31', name: 'Netherlands', example: '06 12345678' },
  { iso: 'NC', dial: '+687', name: 'New Caledonia', example: '75.12.34' },
  { iso: 'NZ', dial: '+64', name: 'New Zealand', example: '021 123 4567' },
  { iso: 'NI', dial: '+505', name: 'Nicaragua', example: '8123 4567' },
  { iso: 'NE', dial: '+227', name: 'Niger', example: '93 12 34 56' },
  { iso: 'NG', dial: '+234', name: 'Nigeria', example: '0802 123 4567' },
  { iso: 'NU', dial: '+683', name: 'Niue', example: '888 4012' },
  { iso: 'NF', dial: '+672', name: 'Norfolk Island', example: '3 81234' },
  { iso: 'KP', dial: '+850', name: 'North Korea', example: '0192 123 4567' },
  { iso: 'MK', dial: '+389', name: 'North Macedonia', example: '072 345 678' },
  { iso: 'MP', dial: '+1', name: 'Northern Mariana Islands', example: '(670) 234-5678' },
  { iso: 'NO', dial: '+47', name: 'Norway', example: '406 12 345', main: true },
  { iso: 'OM', dial: '+968', name: 'Oman', example: '9212 3456' },
  { iso: 'PK', dial: '+92', name: 'Pakistan', example: '0301 2345678' },
  { iso: 'PW', dial: '+680', name: 'Palau', example: '620 1234' },
  { iso: 'PS', dial: '+970', name: 'Palestinian Territories', example: '0599 123 456' },
  { iso: 'PA', dial: '+507', name: 'Panama', example: '6123-4567' },
  { iso: 'PG', dial: '+675', name: 'Papua New Guinea', example: '7012 3456' },
  { iso: 'PY', dial: '+595', name: 'Paraguay', example: '0961 456789' },
  { iso: 'PE', dial: '+51', name: 'Peru', example: '912 345 678' },
  { iso: 'PH', dial: '+63', name: 'Philippines', example: '0905 123 4567' },
  { iso: 'PL', dial: '+48', name: 'Poland', example: '512 345 678' },
  { iso: 'PT', dial: '+351', name: 'Portugal', example: '912 345 678' },
  { iso: 'PR', dial: '+1', name: 'Puerto Rico', example: '(787) 234-5678' },
  { iso: 'QA', dial: '+974', name: 'Qatar', example: '3312 3456' },
  { iso: 'RE', dial: '+262', name: 'Réunion', example: '0692 12 34 56', main: true },
  { iso: 'RO', dial: '+40', name: 'Romania', example: '0712 034 567' },
  { iso: 'RU', dial: '+7', name: 'Russia', example: '8 (912) 345-67-89', main: true },
  { iso: 'RW', dial: '+250', name: 'Rwanda', example: '0720 123 456' },
  { iso: 'WS', dial: '+685', name: 'Samoa', example: '72 12345' },
  { iso: 'SM', dial: '+378', name: 'San Marino', example: '66 66 12 12' },
  { iso: 'ST', dial: '+239', name: 'São Tomé and Príncipe', example: '981 2345' },
  { iso: 'SA', dial: '+966', name: 'Saudi Arabia', example: '051 234 5678' },
  { iso: 'SN', dial: '+221', name: 'Senegal', example: '70 123 45 67' },
  { iso: 'RS', dial: '+381', name: 'Serbia', example: '060 1234567' },
  { iso: 'SC', dial: '+248', name: 'Seychelles', example: '2 510 123' },
  { iso: 'SL', dial: '+232', name: 'Sierra Leone', example: '(025) 123456' },
  { iso: 'SG', dial: '+65', name: 'Singapore', example: '8123 4567' },
  { iso: 'SX', dial: '+1', name: 'Sint Maarten', example: '(721) 520-5678' },
  { iso: 'SK', dial: '+421', name: 'Slovakia', example: '0912 123 456' },
  { iso: 'SI', dial: '+386', name: 'Slovenia', example: '031 234 567' },
  { iso: 'SB', dial: '+677', name: 'Solomon Islands', example: '74 21234' },
  { iso: 'SO', dial: '+252', name: 'Somalia', example: '7 1123456' },
  { iso: 'ZA', dial: '+27', name: 'South Africa', example: '071 123 4567' },
  { iso: 'KR', dial: '+82', name: 'South Korea', example: '010-2000-0000' },
  { iso: 'SS', dial: '+211', name: 'South Sudan', example: '0977 123 456' },
  { iso: 'ES', dial: '+34', name: 'Spain', example: '612 34 56 78' },
  { iso: 'LK', dial: '+94', name: 'Sri Lanka', example: '071 234 5678' },
  { iso: 'BL', dial: '+590', name: 'St. Barthélemy', example: '0690 00 12 34' },
  { iso: 'SH', dial: '+290', name: 'St. Helena', example: '51234', main: true },
  { iso: 'KN', dial: '+1', name: 'St. Kitts and Nevis', example: '(869) 765-2917' },
  { iso: 'LC', dial: '+1', name: 'St. Lucia', example: '(758) 284-5678' },
  { iso: 'MF', dial: '+590', name: 'St. Martin', example: '0690 00 12 34' },
  { iso: 'PM', dial: '+508', name: 'St. Pierre and Miquelon', example: '055 12 34' },
  { iso: 'VC', dial: '+1', name: 'St. Vincent and Grenadines', example: '(784) 430-1234' },
  { iso: 'SD', dial: '+249', name: 'Sudan', example: '091 123 1234' },
  { iso: 'SR', dial: '+597', name: 'Suriname', example: '741-2345' },
  { iso: 'SJ', dial: '+47', name: 'Svalbard and Jan Mayen', example: '41 23 45 67' },
  { iso: 'SE', dial: '+46', name: 'Sweden', example: '070-123 45 67' },
  { iso: 'CH', dial: '+41', name: 'Switzerland', example: '078 123 45 67' },
  { iso: 'SY', dial: '+963', name: 'Syria', example: '0944 567 890' },
  { iso: 'TW', dial: '+886', name: 'Taiwan', example: '0912 345 678' },
  { iso: 'TJ', dial: '+992', name: 'Tajikistan', example: '91 712 3456' },
  { iso: 'TZ', dial: '+255', name: 'Tanzania', example: '0621 234 567' },
  { iso: 'TH', dial: '+66', name: 'Thailand', example: '081 234 5678' },
  { iso: 'TL', dial: '+670', name: 'Timor-Leste', example: '7721 2345' },
  { iso: 'TG', dial: '+228', name: 'Togo', example: '90 11 23 45' },
  { iso: 'TK', dial: '+690', name: 'Tokelau', example: '7290' },
  { iso: 'TO', dial: '+676', name: 'Tonga', example: '771 5123' },
  { iso: 'TT', dial: '+1', name: 'Trinidad and Tobago', example: '(868) 291-1234' },
  { iso: 'TA', dial: '+290', name: 'Tristan da Cunha', example: '8999' },
  { iso: 'TN', dial: '+216', name: 'Tunisia', example: '20 123 456' },
  { iso: 'TR', dial: '+90', name: 'Turkey', example: '0501 234 56 78' },
  { iso: 'TM', dial: '+993', name: 'Turkmenistan', example: '8 66 123456' },
  { iso: 'TC', dial: '+1', name: 'Turks and Caicos Islands', example: '(649) 231-1234' },
  { iso: 'TV', dial: '+688', name: 'Tuvalu', example: '90 1234' },
  { iso: 'VI', dial: '+1', name: 'U.S. Virgin Islands', example: '(340) 642-1234' },
  { iso: 'UG', dial: '+256', name: 'Uganda', example: '0712 345678' },
  { iso: 'UA', dial: '+380', name: 'Ukraine', example: '050 123 4567' },
  { iso: 'AE', dial: '+971', name: 'United Arab Emirates', example: '050 123 4567' },
  { iso: 'GB', dial: '+44', name: 'United Kingdom', example: '07400 123456', main: true },
  { iso: 'US', dial: '+1', name: 'United States', example: '(201) 555-0123', main: true },
  { iso: 'UY', dial: '+598', name: 'Uruguay', example: '094 231 234' },
  { iso: 'UZ', dial: '+998', name: 'Uzbekistan', example: '91 234 56 78' },
  { iso: 'VU', dial: '+678', name: 'Vanuatu', example: '591 2345' },
  { iso: 'VA', dial: '+39', name: 'Vatican City', example: '312 345 6789' },
  { iso: 'VE', dial: '+58', name: 'Venezuela', example: '0412-1234567' },
  { iso: 'VN', dial: '+84', name: 'Vietnam', example: '0912 345 678' },
  { iso: 'WF', dial: '+681', name: 'Wallis and Futuna', example: '82 12 34' },
  { iso: 'EH', dial: '+212', name: 'Western Sahara', example: '06 50 12 34 56' },
  { iso: 'YE', dial: '+967', name: 'Yemen', example: '0712 345 678' },
  { iso: 'ZM', dial: '+260', name: 'Zambia', example: '095 5123456' },
  { iso: 'ZW', dial: '+263', name: 'Zimbabwe', example: '071 234 5678' },
];

const byLanguage = new Map<string, readonly WhatsAppCountry[]>();

/**
 * The picker's countries in the page's language: WHATSAPP_COUNTRIES itself
 * on an English page; on another page each country named in that language
 * by the browser (Intl.DisplayNames; its English name where the browser has
 * none) and sorted the way that language sorts. Codes, dial codes and
 * examples are the same.
 */
export function whatsappCountries(): readonly WhatsAppCountry[] {
  const lang = getLanguage();
  if (lang === 'en') return WHATSAPP_COUNTRIES;
  const tag = localeTag(lang);
  const known = byLanguage.get(tag);
  if (known) return known;
  let names: Intl.DisplayNames | null = null;
  try {
    names = new Intl.DisplayNames(tag, { type: 'region' });
  } catch {
    names = null;
  }
  const nameOf = (c: WhatsAppCountry): string => {
    try {
      const shown = names?.of(c.iso);
      return shown && shown !== c.iso ? shown : c.name;
    } catch {
      return c.name;
    }
  };
  const list = WHATSAPP_COUNTRIES
    .map((c) => ({ ...c, name: nameOf(c) }))
    .sort((a, b) => a.name.localeCompare(b.name, tag));
  byLanguage.set(tag, list);
  return list;
}

/** The picker's ISO code for a code or a locale's region, when the picker has it ("bg" gives "BG"), else null. */
export function whatsappCountry(code: string | null | undefined): string | null {
  const iso = String(code || '').trim().toUpperCase();
  return WHATSAPP_COUNTRIES.some((c) => c.iso === iso) ? iso : null;
}

/**
 * The picker's country for a number typed with its dial code ("+359 88..."):
 * the longest dial code that starts it and, for a shared one (+1, +7, +44...),
 * its main country. Null for a number without "+" or a code no country has.
 */
export function whatsappCountryOfNumber(
  phone: string | null | undefined,
  countries: ReadonlyArray<Pick<WhatsAppCountry, 'iso' | 'dial' | 'main'>> = WHATSAPP_COUNTRIES,
): string | null {
  const digits = String(phone || '').replace(/[^\d+]/g, '');
  if (!digits.startsWith('+')) return null;
  const match = countries
    .filter((c) => digits.startsWith(c.dial))
    .sort((a, b) => b.dial.length - a.dial.length || Number(!!b.main) - Number(!!a.main))[0];
  return match ? match.iso : null;
}
