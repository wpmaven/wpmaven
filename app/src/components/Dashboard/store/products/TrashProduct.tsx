import React, { useState } from 'react';
import { editFailure, errorSentence, storeApi } from '../../../../services/storeApi';
import type { StoreEditResult } from '../../../../types/store';
import Confirm from '../shared/Confirm';
import { TRASH_COPY, trashMessage } from '../storeCopy';

/**
 * "Move to trash" for a product: a preview first (it says where a designed
 * page still shows the product's card), then the confirm, then the change
 * by its preview, with an undo in the result line. The route checks the
 * user's right to delete products again.
 */
export default function TrashProduct({ productId, name, printed, disabled, onDone, onError }: {
  productId: number;
  name: string;
  printed: boolean;
  disabled?: boolean;
  /** The trash went through: its result (the caller shows the line with Undo, and reads its rows again). */
  onDone: (result: StoreEditResult) => void;
  onError: (problem: { code: string; message: string }) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState<{ previewId: string; message: string } | null>(null);
  const operation = { op: 'remove_product' as const, productId };

  const ask = async () => {
    setBusy(true);
    try {
      const preview = await storeApi.edit(operation, { mode: 'preview' });
      const failure = editFailure(preview);
      if (failure || !preview.previewId) {
        onError(failure ?? { code: 'ENGINE', message: 'This product could not be moved to the trash. Try again.' });
        return;
      }
      const warnings = (preview.checks ?? []).filter((c) => c.severity !== 'info').map((c) => c.message);
      setAsking({ previewId: preview.previewId, message: trashMessage(name, warnings, printed) });
    } catch (error) {
      onError({ code: '', message: errorSentence(error, 'This product could not be moved to the trash. Try again.') });
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    const previewId = asking?.previewId;
    setAsking(null);
    if (!previewId) return;
    setBusy(true);
    try {
      const answer = await storeApi.edit(operation, { mode: 'publish', previewId });
      const failure = editFailure(answer);
      if (failure) onError(failure);
      else onDone(answer);
    } catch (error) {
      onError({ code: '', message: errorSentence(error, 'This product could not be moved to the trash. Try again.') });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button type="button" className="wm-store-link wm-store-link--danger" onClick={() => void ask()} disabled={disabled || busy} data-testid="store-trash-product">
        {busy ? 'Moving to the trash' : TRASH_COPY.button}
      </button>
      <Confirm
        open={!!asking}
        title={TRASH_COPY.title}
        message={asking?.message ?? ''}
        confirmLabel={TRASH_COPY.button}
        cancelLabel={TRASH_COPY.keep}
        danger
        onConfirm={() => void confirm()}
        onCancel={() => setAsking(null)}
      />
    </>
  );
}
