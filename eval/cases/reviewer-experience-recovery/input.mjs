// Failure transition used by the order editor after a rejected save request.
export function failedSave(editor) {
  return { ...editor, draft: '', saving: false, error: 'Save failed. Retry.' };
}
