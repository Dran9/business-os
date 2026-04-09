import ConfirmButton from './ConfirmButton'

export default function BulkActionBar({ count, onDelete, onClear, deleteLabel = 'Eliminar' }) {
  if (count === 0) return null

  return (
    <div className="bulk-action-bar">
      <span className="bulk-count">{count} seleccionado{count !== 1 ? 's' : ''}</span>
      <ConfirmButton
        label={`${deleteLabel} (${count})`}
        confirmLabel={`¿${deleteLabel} ${count}?`}
        onConfirm={onDelete}
        size="sm"
      />
      <button type="button" className="btn btn-ghost btn-sm" onClick={onClear}>
        Cancelar
      </button>
    </div>
  )
}
