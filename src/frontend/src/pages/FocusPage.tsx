import { lazy, Suspense } from 'react'
import { Spin } from 'antd'
import { LOCAL_MODE } from '../local/mode'

const LocalDailyPage = lazy(() => import('./LocalDailyPage'))
const LegacyFocusPage = lazy(() => import('./LegacyFocusPage'))

export default function FocusPage() {
  return (
    <Suspense fallback={<Spin />}>{LOCAL_MODE ? <LocalDailyPage /> : <LegacyFocusPage />}</Suspense>
  )
}
