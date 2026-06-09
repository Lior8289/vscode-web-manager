import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import App from './App.tsx'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1_000,
      refetchOnWindowFocus: false,
    },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
      <Toaster
        position="bottom-right"
        theme="dark"
        toastOptions={{
          unstyled: false,
          classNames: {
            toast:
              'group !bg-ink-raised !text-bone !border !border-ink-line !rounded-xs !shadow-none font-sans',
            title: '!text-bone !text-[13px] !font-medium',
            description: '!text-bone-dim !text-[12px] !font-mono',
            actionButton:
              '!bg-volt !text-ink !rounded-xs !font-mono !text-[11px] !tracking-[0.04em]',
            cancelButton:
              '!bg-transparent !text-bone-dim !font-mono !text-[11px]',
            error: '!border-fault/40',
            success: '!border-ink-line',
            warning: '!border-warn/40',
          },
        }}
        gap={8}
        offset={20}
      />
    </QueryClientProvider>
  </StrictMode>,
)
