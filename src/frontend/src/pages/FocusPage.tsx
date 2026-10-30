import { lazy, Suspense } from 'react'
import { Spin } from 'antd'
import { LOCAL_MODE } from '../local/mode'

const LocalDailyPage = lazy(() => import('./LocalDailyPage'))
const LegacyFocusPage = lazy(() => import('./LegacyFocusPage'))

export default function FocusPage({ embedded = false }: { embedded?: boolean }) {
  return (
    <Suspense fallback={<Spin />}>{LOCAL_MODE ? <LocalDailyPage embedded={embedded} /> : <LegacyFocusPage />}</Suspense>
  )
}
