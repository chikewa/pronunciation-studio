import { useCallback, useEffect, useState } from 'react'
import { Lesson } from './api'
import HomeView from './components/HomeView'
import LessonList from './components/LessonList'
import LessonView from './components/LessonView'
import ProgressView from './components/ProgressView'

type View = 'home' | 'lessons' | 'lesson' | 'progress'

export default function App() {
  const [view, setView] = useState<View>('home')
  const [activeLesson, setActiveLesson] = useState<Lesson | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)

  const openLesson = useCallback((l: Lesson) => { setActiveLesson(l); setView('lesson'); setMenuOpen(false) }, [])
  const goLessons = useCallback(() => { setView('lessons'); setMenuOpen(false) }, [])
  const goProgress = useCallback(() => { setView('progress'); setMenuOpen(false) }, [])
  const goHome = useCallback(() => { setView('home'); setMenuOpen(false) }, [])

  // close mobile menu on navigation
  useEffect(() => { setMenuOpen(false) }, [view])

  const Nav = ({ compact }: { compact?: boolean }) => (
    <nav className={compact ? '' : 'space-y-1'}>
      <NavItem active={view === 'home'} onClick={goHome} label="Home" icon="⌂" />
      <NavItem active={view === 'lessons' || view === 'lesson'} onClick={goLessons} label="Lessons" icon="📚" />
      <NavItem active={view === 'progress'} onClick={goProgress} label="Progress" icon="📈" />
    </nav>
  )

  return (
    <div className="min-h-screen bg-ink-50 text-ink-900">
      {/* top bar (mobile) */}
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-ink-200 bg-white/90 px-4 py-3 backdrop-blur md:hidden">
        <button onClick={goHome} className="text-lg font-bold">🎯 Pronunciation Studio</button>
        <button onClick={() => setMenuOpen((v) => !v)} aria-label="Menu"
          className="rounded-md border border-ink-300 px-3 py-1.5 text-sm">{menuOpen ? '✕' : '☰'}</button>
      </header>
      {menuOpen && (
        <div className="border-b border-ink-200 bg-white px-4 py-3 md:hidden">
          <Nav compact />
        </div>
      )}

      <div className="mx-auto flex max-w-6xl">
        {/* sidebar (desktop) */}
        <aside className="hidden w-56 shrink-0 border-r border-ink-200 bg-white p-4 md:block">
          <button onClick={goHome} className="mb-6 text-left text-lg font-bold">
            🎯 <span className="block">Pronunciation Studio</span>
          </button>
          <Nav />
          <div className="mt-8 rounded-lg bg-ink-100 p-3 text-xs text-ink-500">
            <p className="font-semibold text-ink-600">Local & private</p>
            <p className="mt-1">All analysis runs on this computer. Recordings never leave it.</p>
          </div>
        </aside>

        {/* main */}
        <main className="min-w-0 flex-1 p-4 md:p-8">
          {view === 'home' && <HomeView onLessons={goLessons} onProgress={goProgress} />}
          {view === 'lessons' && <LessonList onOpen={openLesson} onProgress={goProgress} onHome={goHome} />}
          {view === 'lesson' && activeLesson && (
            <LessonView key={activeLesson.id} lesson={activeLesson} onLessonList={goLessons} />
          )}
          {view === 'progress' && <ProgressView onLessons={goLessons} />}
        </main>
      </div>
    </div>
  )
}

function NavItem({ active, onClick, label, icon }:
  { active: boolean; onClick: () => void; label: string; icon: string }) {
  return (
    <button onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium ${
        active ? 'bg-ink-900 text-white' : 'text-ink-600 hover:bg-ink-100'}`}>
      <span aria-hidden>{icon}</span>{label}
    </button>
  )
}
