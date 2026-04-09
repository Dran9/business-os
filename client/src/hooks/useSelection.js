import { useCallback, useState } from 'react'

export default function useSelection() {
  const [selected, setSelected] = useState(new Set())

  const toggle = useCallback((id) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const toggleAll = useCallback((ids) => {
    setSelected((prev) => {
      if (prev.size === ids.length && ids.every((id) => prev.has(id))) {
        return new Set()
      }
      return new Set(ids)
    })
  }, [])

  const clear = useCallback(() => setSelected(new Set()), [])

  const isSelected = useCallback((id) => selected.has(id), [selected])

  return {
    selected,
    count: selected.size,
    toggle,
    toggleAll,
    clear,
    isSelected,
    ids: () => Array.from(selected),
  }
}
