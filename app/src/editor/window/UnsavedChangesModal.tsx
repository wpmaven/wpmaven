import React, { useState } from 'react';
import { Button } from '@yotako/webmaven-ui';
import { WINDOW_WORDS, caseLabel } from './labels';

interface UnsavedChangesModalProps {
	/** Its own words when it asks something else (leaving the editor with changes open). */
	title?: string;
	saveLabel?: string;
	discardLabel?: string;
	message: string;
	onSave: () => Promise<void>;
	onDiscard: () => void;
	onCancel: () => void;
}

export function UnsavedChangesModal({ title, saveLabel, discardLabel, message, onSave, onDiscard, onCancel }: UnsavedChangesModalProps) {
	const [saving, setSaving] = useState(false);

	async function handleSave() {
		setSaving(true);
		try {
			await onSave();
		} finally {
			setSaving(false);
		}
	}

	return (
		<div
			onClick={onCancel}
			role="dialog"
			aria-modal="true"
			data-testid="editor-leave-guard"
			style={{
				position: 'fixed',
				inset: 0,
				zIndex: 1000,
				background: 'rgba(0, 0, 0, 0.5)',
				backdropFilter: 'blur(4px)',
				WebkitBackdropFilter: 'blur(4px)',
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'center',
				fontFamily: '"Inter", sans-serif',
			}}
		>
			<div
				onClick={e => e.stopPropagation()}
				style={{
					width: 340,
					background: 'color-mix(in srgb, var(--bg) 90%, transparent)',
					backdropFilter: 'blur(24px)',
					WebkitBackdropFilter: 'blur(24px)',
					border: '1px solid var(--glass-border)',
					borderRadius: 16,
					boxShadow: 'var(--glass-shadow)',
					padding: '24px',
				}}
			>
				<h3 style={{ margin: '0 0 8px', fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>
					{caseLabel(title ?? WINDOW_WORDS.unsavedTitle)}
				</h3>
				<p style={{ margin: '0 0 20px', fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.5 }}>
					{message}
				</p>
				<div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
					<Button variant="ghost" size="sm" onClick={onDiscard} data-testid="editor-leave-discard">
						{caseLabel(discardLabel ?? WINDOW_WORDS.discard)}
					</Button>
					<Button variant="primary" size="sm" onClick={handleSave} isLoading={saving} data-testid="editor-leave-apply">
						{caseLabel(saveLabel ?? WINDOW_WORDS.applyAndContinue)}
					</Button>
				</div>
			</div>
		</div>
	);
}
