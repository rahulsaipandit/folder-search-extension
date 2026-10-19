import { useState } from 'react'

import { useI18n } from '@/i18n'
import type { TranslationKey } from '@/i18n/locales'
import { extensionName } from '@/shared/extensionName'
import { type FeedbackField, extensionLabel, submitFeedback, tooFast, validateFeedback } from '@/shared/feedback'
import { getFeedbackFormConfig } from '@/shared/reviewConfig'

const FIELD_ERROR: Record<FeedbackField, TranslationKey> = {
	name: 'feedback.errorName',
	email: 'feedback.errorEmail',
	message: 'feedback.errorMessage',
}

const inputClass =
	'bg-background border-input w-full rounded-2xl border px-4 py-3 text-base outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50'
const labelClass = 'text-muted-foreground mb-1 block text-sm font-semibold uppercase'

/**
 * Feedback form opened from the review prompt for 1-3 star ratings. "Extension used" comes from the
 * `?ext=` query string. Posts to the Google Form with no-cors, so delivery cannot be confirmed
 * (design: docs/designGuidelines.md §5). No reCAPTCHA: it would load remote script (MV3 forbids it).
 */
export function FeedbackPage() {
	const { t } = useI18n()
	const [cfg] = useState(getFeedbackFormConfig)
	const [extension] = useState(() => extensionLabel(location.search, extensionName()))
	const [openedAt] = useState(Date.now)
	const [name, setName] = useState('')
	const [email, setEmail] = useState('')
	const [message, setMessage] = useState('')
	const [honeypot, setHoneypot] = useState('')
	const [errors, setErrors] = useState<FeedbackField[]>([])
	const [formError, setFormError] = useState<string | null>(cfg ? null : t('feedback.errorNotConfigured'))
	const [status, setStatus] = useState<'idle' | 'sending' | 'sent'>('idle')

	const submit = async (e: React.FormEvent) => {
		e.preventDefault()
		if (!cfg || status === 'sending') return
		const fields = { extension, name, email, message }
		const bad = validateFeedback(fields)
		setErrors(bad)
		if (bad.length) return setFormError(null)
		if (honeypot) return setStatus('sent') // bots get a fake success; nothing is sent
		if (tooFast(Date.now() - openedAt)) return setFormError(t('feedback.errorTooFast'))
		setFormError(null)
		setStatus('sending')
		try {
			await submitFeedback(cfg, fields)
			setStatus('sent')
		} catch (err) {
			console.error('[feedback] submit failed:', err)
			setFormError(t('feedback.errorNetwork'))
			setStatus('idle')
		}
	}

	if (status === 'sent') {
		return (
			<main className="mx-auto max-w-xl px-6 py-16 text-center">
				<h1 className="text-3xl font-bold">{t('feedback.thanks')}</h1>
				<p className="text-muted-foreground mt-3">{t('feedback.thanksBody')}</p>
			</main>
		)
	}

	return (
		<main className="mx-auto max-w-xl px-6 py-10">
			<h1 className="mb-6 text-4xl font-extrabold">{t('feedback.pageTitle')}</h1>
			<form onSubmit={submit} noValidate className="bg-muted/50 relative space-y-5 rounded-3xl p-8">
				<div>
					<span className={labelClass}>{t('feedback.extensionUsed')}</span>
					<p className="px-1 text-base">{extension}</p>
				</div>
				<div>
					<label htmlFor="fb-name" className={labelClass}>
						{t('feedback.name')} <span className="text-red-600">*</span>
					</label>
					<input
						id="fb-name"
						value={name}
						onChange={e => setName(e.target.value)}
						placeholder={t('feedback.namePlaceholder')}
						aria-invalid={errors.includes('name')}
						className={inputClass}
					/>
				</div>
				<div>
					<label htmlFor="fb-email" className={labelClass}>
						{t('feedback.email')}
					</label>
					<input
						id="fb-email"
						type="email"
						value={email}
						onChange={e => setEmail(e.target.value)}
						placeholder={t('feedback.emailPlaceholder')}
						aria-invalid={errors.includes('email')}
						className={inputClass}
					/>
				</div>
				<div>
					<label htmlFor="fb-message" className={labelClass}>
						{t('feedback.message')} <span className="text-red-600">*</span>
					</label>
					<textarea
						id="fb-message"
						rows={7}
						value={message}
						onChange={e => setMessage(e.target.value)}
						placeholder={t('feedback.messagePlaceholder')}
						aria-invalid={errors.includes('message')}
						className={inputClass}
					/>
				</div>
				{/* Honeypot: invisible to people, tempting to bots. */}
				<input
					name="hp_x7"
					tabIndex={-1}
					autoComplete="off"
					aria-hidden="true"
					value={honeypot}
					onChange={e => setHoneypot(e.target.value)}
					className="absolute -left-[9999px] h-0 w-0 opacity-0"
				/>
				{(errors.length > 0 || formError) && (
					<ul role="alert" className="space-y-1 text-sm text-red-600">
						{errors.map(f => (
							<li key={f}>{t(FIELD_ERROR[f])}</li>
						))}
						{formError && <li>{formError}</li>}
					</ul>
				)}
				<p className="text-muted-foreground text-xs">{t('feedback.privacy')}</p>
				<button
					type="submit"
					disabled={!cfg || status === 'sending'}
					className="w-full rounded-full bg-blue-500 py-4 text-lg font-bold text-white hover:bg-blue-600 disabled:opacity-50"
				>
					{status === 'sending' ? t('feedback.sending') : t('feedback.submit')}
				</button>
			</form>
		</main>
	)
}
