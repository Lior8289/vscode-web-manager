export function ShortcutsHint() {
  return (
    <footer className="mx-auto max-w-[1200px] px-6 sm:px-10 py-10 mt-12 border-t border-ink-line">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-5 font-mono text-[11px] text-bone-mute tracking-[0.04em]">
          <Shortcut k="N" label="new" />
          <Shortcut k="R" label="refresh" />
          <Shortcut k="Esc" label="dismiss" />
        </div>
        <div className="font-mono text-[10.5px] text-bone-mute uppercase tracking-[0.18em]">
          cymotive · home task · 2026
        </div>
      </div>
    </footer>
  )
}

function Shortcut({ k, label }: { k: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <kbd className="inline-flex h-5 min-w-[20px] items-center justify-center px-1.5 border border-ink-line text-bone-dim rounded-xs">
        {k}
      </kbd>
      <span className="uppercase">{label}</span>
    </span>
  )
}
