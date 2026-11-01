// Dev-only preview with fake people, for checking the look without signing in.
// Open http://localhost:5173/?preview&tab=feed (also: &theme=dark, &lang=de, &sheet=person|settings|wheel|sos|busy).
// Never included in the live site: main.tsx only loads it when import.meta.env.DEV is true.
import { useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { AppContext, type AppState, type Tab } from './lib/app'
import { OnlineContext } from './lib/presence'
import { Avatar, Icons } from './components/ui'
import { t } from './lib/i18n'
import { Feed } from './screens/Feed'
import { MapScreen } from './screens/MapScreen'
import { Meetups } from './screens/Meetups'
import { GroupScreen } from './screens/GroupScreen'
import { SettingsScreen } from './screens/Settings'
import { PersonSheet } from './screens/Waves'
import { WheelSheet } from './screens/Wheel'
import { Tutorial } from './screens/Tutorial'
import type { Group, Member } from './types'

const today = new Date()
const bday = `2008-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`

const ME: Member = { id: 'me', username: 'manu', display_name: 'Manu', emoji: '😎', color: '#ff7a1a', location_mode: 'live', role: 'admin', bio: 'Football, pizza and late-night gaming.', favs: { food: 'Pizza', game: 'FIFA' }, birthday: '2008-03-14', privacy: {} }
const MEMBERS: Member[] = [
  ME,
  { id: 'lea', username: 'lea', display_name: 'Lea', emoji: '🦊', color: '#c04cf2', location_mode: 'live', role: 'member', bio: 'Always 5 min late 🙈', favs: { food: 'Sushi', music: 'Taylor Swift', place: 'The lake' }, birthday: bday },
  { id: 'max', username: 'max', display_name: 'Max', emoji: '🐼', color: '#13c2a3', location_mode: 'manual', role: 'member', busy_until: new Date(Date.now() + 2 * 3600e3).toISOString() },
  { id: 'jan', username: 'jan', display_name: 'Jan', emoji: '🤖', color: '#5b6cff', location_mode: 'off', role: 'member' },
]
const GROUP: Group = { id: '00000000-0000-0000-0000-000000000000', name: 'The Squad', invite_code: 'K7PX2Q', created_by: 'me' }

export default function Preview() {
  const q = new URLSearchParams(window.location.search)
  const [tab, setTab] = useState<Tab>((q.get('tab') as Tab) || 'feed')
  const [sheet, setSheet] = useState(q.get('sheet'))
  const sosOn = sheet === 'sos'
  const state: AppState = {
    session: {} as Session,
    me: ME,
    setMe: () => {},
    groups: [GROUP, { ...GROUP, id: 'g2', name: 'Football crew' }],
    group: GROUP,
    selectGroup: () => {},
    reloadGroups: async () => [GROUP],
    members: MEMBERS,
    goTab: setTab,
    openNewMeetup: () => {},
    openPerson: () => setSheet('person'),
    muted: new Set(),
    toggleMute: () => {},
    isAdmin: true,
    openTutorial: () => setSheet('tutorial'),
    sos: {
      alerts: sosOn ? [{ id: 's1', group_id: GROUP.id, user_id: 'lea', lat: 48.2, lng: 16.37, created_at: new Date(Date.now() - 120e3).toISOString(), updated_at: new Date().toISOString(), resolved_at: null }] : [],
      mine: undefined,
      send: async () => {},
      end: async () => {},
    },
  }
  const TABS: Tab[] = ['feed', 'map', 'meetups', 'group', 'me']
  return (
    <AppContext.Provider value={state}>
      <OnlineContext.Provider value={new Set(['me', 'lea'])}>
        <div className="app">
          <header className="topbar">
            {tab === 'me' ? (
              <h1 className="grow">{t('Settings')}</h1>
            ) : (
              <button className="group-switch grow">
                <span className="eyebrow">{t(tab === 'feed' ? 'Feed' : tab === 'map' ? 'Map' : tab === 'meetups' ? 'Meetups' : 'Group')}</span>
                <span className="group-title">
                  <span className="ellipsis">{GROUP.name}</span>
                  <span className="chev">▾</span>
                </span>
              </button>
            )}
          </header>
          {sosOn && (
            <div className="sos-banners">
              <div className="sos-banner">
                <span className="grow">
                  <b>🆘 {t('{name} needs help', { name: 'Lea' })}</b>
                  <span className="block tiny">2 min ago</span>
                </span>
                <button className="btn small light">{t('Show on map')}</button>
              </div>
            </div>
          )}
          <main className={'screen' + (tab === 'map' ? ' full' : '')}>
            {tab === 'feed' && <Feed />}
            {tab === 'map' && <MapScreen />}
            {tab === 'meetups' && <Meetups />}
            {tab === 'group' && <GroupScreen />}
            {tab === 'me' && <SettingsScreen />}
          </main>
          <nav className="tabbar">
            {TABS.map((x) => (
              <button key={x} className={'tab' + (tab === x ? ' on' : '')} onClick={() => setTab(x)}>
                {x === 'me' ? (
                  <span className="tab-avatar">
                    <Avatar p={ME} size={20} />
                  </span>
                ) : (
                  Icons[x as keyof typeof Icons]
                )}
                {t(x === 'feed' ? 'Feed' : x === 'map' ? 'Map' : x === 'meetups' ? 'Meetups' : x === 'group' ? 'Group' : 'You')}
              </button>
            ))}
          </nav>
        </div>
        {sheet === 'person' && <PersonSheet person={MEMBERS[1]} onClose={() => setSheet(null)} />}
        {sheet === 'wheel' && <WheelSheet onClose={() => setSheet(null)} />}
        {sheet === 'tutorial' && <Tutorial onDone={() => setSheet(null)} />}
      </OnlineContext.Provider>
    </AppContext.Provider>
  )
}
