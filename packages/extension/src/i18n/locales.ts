/**
 * UI locale resources for the extension sidepanel.
 *
 * Separate from `@page-agent/ui`'s own `I18n`, which localizes that package's Panel.
 * The language is chosen on the Manage page and stored as `UnifiedSettings.uiLanguage`.
 * `en-US` is the base/reference language — every other locale must match its key structure.
 */

export type SupportedUILanguage = 'en-US' | 'de-DE' | 'zh-CN' | 'zh-HK'

export const SUPPORTED_UI_LANGUAGES: SupportedUILanguage[] = ['en-US', 'de-DE', 'zh-CN', 'zh-HK']

/** Native display name shown for each option in the language picker itself. */
export const UI_LANGUAGE_NATIVE_NAMES: Record<SupportedUILanguage, string> = {
	'en-US': 'English',
	'de-DE': 'Deutsch',
	'zh-CN': '简体中文',
	'zh-HK': '繁體中文 (香港)',
}

const enUS = {
	settings: {
		interfaceLanguage: 'Interface Language',
		interfaceLanguageAuto: 'Auto ({{language}})',
	},
	review: {
		title: 'Enjoying Folder Search?',
		subtitle: 'Every review helps us improve',
		maybeLater: 'Maybe later',
		close: 'Close',
		rate: 'Rate {{count}} out of 5',
	},
	feedback: {
		pageTitle: 'Share your feedback',
		name: 'Your name',
		namePlaceholder: 'Enter your name',
		email: 'Your email (optional)',
		emailPlaceholder: 'Enter your email',
		message: 'Your message',
		messagePlaceholder: 'Enter your message',
		extensionUsed: 'Extension used',
		privacy: 'Sending this form shares only the fields above and the extension name with the developer. Nothing else is collected.',
		submit: 'Submit',
		sending: 'Sending...',
		thanks: 'Thank you for your feedback!',
		thanksBody: 'You can close this tab.',
		errorName: 'Please enter your name.',
		errorEmail: 'Please enter a valid email address or leave it empty.',
		errorMessage: 'Please enter a message.',
		errorTooFast: 'Please take a moment to write your message, then submit again.',
		errorNetwork: 'Could not send your feedback. Check your internet connection and try again.',
		errorNotConfigured: 'Feedback is not configured in this build.',
	},
} as const

const deDE: TranslationSchema = {
	settings: {
		interfaceLanguage: 'Oberflächensprache',
		interfaceLanguageAuto: 'Automatisch ({{language}})',
	},
	review: {
		title: 'Gefällt Ihnen Folder Search?',
		subtitle: 'Jede Bewertung hilft uns, besser zu werden',
		maybeLater: 'Vielleicht später',
		close: 'Schließen',
		rate: '{{count}} von 5 Sternen vergeben',
	},
	feedback: {
		pageTitle: 'Teilen Sie Ihr Feedback',
		name: 'Ihr Name',
		namePlaceholder: 'Namen eingeben',
		email: 'Ihre E-Mail (optional)',
		emailPlaceholder: 'E-Mail-Adresse eingeben',
		message: 'Ihre Nachricht',
		messagePlaceholder: 'Nachricht eingeben',
		extensionUsed: 'Verwendete Erweiterung',
		privacy: 'Beim Absenden werden nur die obigen Felder und der Name der Erweiterung an den Entwickler übermittelt. Es wird nichts anderes erfasst.',
		submit: 'Absenden',
		sending: 'Wird gesendet ...',
		thanks: 'Vielen Dank für Ihr Feedback!',
		thanksBody: 'Sie können diesen Tab schließen.',
		errorName: 'Bitte geben Sie Ihren Namen ein.',
		errorEmail: 'Bitte geben Sie eine gültige E-Mail-Adresse ein oder lassen Sie das Feld leer.',
		errorMessage: 'Bitte geben Sie eine Nachricht ein.',
		errorTooFast: 'Bitte nehmen Sie sich einen Moment für Ihre Nachricht und senden Sie dann erneut.',
		errorNetwork: 'Ihr Feedback konnte nicht gesendet werden. Prüfen Sie Ihre Internetverbindung und versuchen Sie es erneut.',
		errorNotConfigured: 'Feedback ist in diesem Build nicht konfiguriert.',
	},
}

const zhCN: TranslationSchema = {
	settings: {
		interfaceLanguage: '界面语言',
		interfaceLanguageAuto: '自动 ({{language}})',
	},
	review: {
		title: '喜欢 Folder Search 吗？',
		subtitle: '每一条评价都帮助我们改进',
		maybeLater: '以后再说',
		close: '关闭',
		rate: '评 {{count}} 星（满分 5 星）',
	},
	feedback: {
		pageTitle: '分享您的反馈',
		name: '您的姓名',
		namePlaceholder: '请输入姓名',
		email: '您的邮箱（选填）',
		emailPlaceholder: '请输入邮箱',
		message: '您的留言',
		messagePlaceholder: '请输入留言',
		extensionUsed: '使用的扩展',
		privacy: '提交时只会向开发者发送上述字段和扩展名称，不会收集其他任何内容。',
		submit: '提交',
		sending: '正在发送…',
		thanks: '感谢您的反馈！',
		thanksBody: '您可以关闭此标签页。',
		errorName: '请输入您的姓名。',
		errorEmail: '请输入有效的邮箱地址，或留空。',
		errorMessage: '请输入留言。',
		errorTooFast: '请花一点时间写下留言，然后再次提交。',
		errorNetwork: '无法发送您的反馈。请检查网络连接后重试。',
		errorNotConfigured: '此版本未配置反馈功能。',
	},
}

const zhHK: TranslationSchema = {
	settings: {
		interfaceLanguage: '介面語言',
		interfaceLanguageAuto: '自動（{{language}}）',
	},
	review: {
		title: '喜歡 Folder Search 嗎？',
		subtitle: '每一則評價都幫助我們改進',
		maybeLater: '稍後再說',
		close: '關閉',
		rate: '評 {{count}} 星（滿分 5 星）',
	},
	feedback: {
		pageTitle: '分享您的意見',
		name: '您的姓名',
		namePlaceholder: '請輸入姓名',
		email: '您的電郵（選填）',
		emailPlaceholder: '請輸入電郵',
		message: '您的留言',
		messagePlaceholder: '請輸入留言',
		extensionUsed: '使用的擴充功能',
		privacy: '提交時只會向開發者傳送上述欄位和擴充功能名稱，不會收集其他任何內容。',
		submit: '提交',
		sending: '正在傳送…',
		thanks: '感謝您的意見！',
		thanksBody: '您可以關閉此分頁。',
		errorName: '請輸入您的姓名。',
		errorEmail: '請輸入有效的電郵地址，或留空。',
		errorMessage: '請輸入留言。',
		errorTooFast: '請花一點時間寫下留言，然後再次提交。',
		errorNetwork: '無法傳送您的意見。請檢查網絡連線後再試。',
		errorNotConfigured: '此版本未設定意見回饋功能。',
	},
}

type DeepStringify<T> = {
	[K in keyof T]: T[K] extends string ? string : T[K] extends object ? DeepStringify<T[K]> : T[K]
}

export type TranslationSchema = DeepStringify<typeof enUS>

type Join<K extends string, P extends string> = P extends '' ? K : `${K}.${P}`
type PathsOf<T> = T extends string
	? ''
	: { [K in keyof T & string]: Join<K, PathsOf<T[K]>> }[keyof T & string]

export type TranslationKey = PathsOf<typeof enUS>
export type TranslationParams = Record<string, string | number>

export const locales: Record<SupportedUILanguage, TranslationSchema> = {
	'en-US': enUS,
	'de-DE': deDE,
	'zh-CN': zhCN,
	'zh-HK': zhHK,
}
