import { useCallback, useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { configured, supabase } from './lib/supabase'
import { AppContext, store, useApp, type AppState, type MeetupDraft, type Tab } from './lib/app'
import { useOnTheWay } from './lib/onTheWay'
import { useLiveLocation } from './lib/location'
import { Avatar, Icons, Splash } from './components/ui'
import { AuthScreen } from './screens/Auth'
import { ProfileSetup } from './screens/ProfileForm'
import { GroupStart } from './screens/GroupStart'
import { Feed } from './screens/Feed'
import { MapScreen } from './screens/MapScreen'
import { Meetups, NewMeetup } from './screens/Meetups'
import { GroupScreen } from './screens/GroupScreen'
import { WaveInbox } from './screens/Waves'
import type { Group, Member, Profile } from './types'

export default function App() {
  if (!configured) return <SetupNeeded />
  return <Root />
}

function Root() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  if (session === undefined) return <Splash />
  if (!session) return <AuthScreen />
  return <SignedIn session={session} key={session.user.id} />
}

function SignedIn({ session }: { session: Session }) {
  const uid = session.user.id
  const [me, setMe] = useState<Profile | null | undefined>(undefined)
  const [groups, setGroups] = useState<Group[] | undefined>(undefined)
  const [groupId, setGroupId] = useState<string | null>(() => store.get('groupId'))
  const [members, setMembers] = useState<Member[]>([])
  const [tab, setTab] = useState<Tab>(() => {
    // Notifications open links like /?tab=meetups
    const fromLink = new URLSearchParams(window.location.search).get('tab') as Tab | null
    if (fromLink) window.history.replaceState(null, '', '/')
    return fromLink ?? ((store.get('tab') as Tab) || 'feed')
  })
  const [draft, setDraft] = useState<MeetupDraft | null>(null)
  const goTab = useCallback((t: Tab) => {
    setTab(t)
    store.set('tab', t)
  }, [])

  useEffect(() => {
    supabase
      .from('profiles')
      .select('*')
      .eq('id', uid)
      .maybeSingle()
      .then(({ data }) => setMe((data as Profile | null) ?? null))
  }, [uid])

  const reloadGroups = useCallback(async () => {
    const { data } = await supabase.from('group_members').select('groups(*)').eq('user_id', uid)
    const list = ((data ?? []) as unknown as { groups: Group | null }[])
      .map((r) => r.groups)
      .filter((g): g is Group => !!g)
      .sort((a, b) => a.name.localeCompare(b.name))
    setGroups(list)
    return list
  }, [uid])

  const hasProfile = !!me

  // Remember the timezone, so reminders and the daily nudge come at the right local time
  useEffect(() => {
    if (!me) return
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (tz && me.timezone !== tz) supabase.from('profiles').update({ timezone: tz }).eq('id', me.id).then(() => {})
  }, [me])
  useEffect(() => {
    if (hasProfile) reloadGroups()
  }, [hasProfile, reloadGroups])

  const group = groups?.find((g) => g.id === groupId) ?? groups?.[0]
  const gid = group?.id

  const selectGroup = useCallback((id: string) => {
    setGroupId(id)
    store.set('groupId', id)
  }, [])

  // Members of the open group, kept live
  useEffect(() => {
    if (!gid) return
    let alive = true
    const load = async () => {
      const { data } = await supabase.from('group_members').select('role, profiles(*)').eq('group_id', gid)
      if (!alive) return
      const rows = (data ?? []) as unknown as { role: Member['role']; profiles: Profile | null }[]
      setMembers(rows.filter((r) => r.profiles).map((r) => ({ ...(r.profiles as Profile), role: r.role })))
    }
    load()
    const ch = supabase
      .channel('members-' + gid)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'group_members', filter: `group_id=eq.${gid}` }, load)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles' }, load)
      .subscribe()
    return () => {
      alive = false
      supabase.removeChannel(ch)
    }
  }, [gid])

  if (me === undefined) return <Splash />
  if (me === null) return <ProfileSetup userId={uid} onDone={setMe} />
  if (groups === undefined) return <Splash />
  if (!group)
    return (
      <GroupStart
        onDone={async (g) => {
          await reloadGroups()
          selectGroup(g.id)
        }}
      />
    )

  const state: AppState = {
    session, me, setMe, groups, group, selectGroup, reloadGroups, members, goTab,
    openNewMeetup: (d) => setDraft(d ?? {}),
  }
  return (
    <AppContext.Provider value={state}>
      <Shell tab={tab} />
      <WaveInbox />
      {draft && <NewMeetup draft={draft} onClose={() => setDraft(null)} onCreated={() => goTab('meetups')} />}
    </AppContext.Provider>
  )
}

const TABS: { id: Tab; label: string }[] = [
  { id: 'feed', label: 'Feed' },
  { id: 'map', label: 'Map' },
  { id: 'meetups', label: 'Meetups' },
  { id: 'group', label: 'Group' },
]

function Shell({ tab }: { tab: Tab }) {
  const { me, group, goTab: go } = useApp()
  useLiveLocation(me.id, me.location_mode)
  useOnTheWay(me.id)

  return (
    <div className="app">
      <header className="topbar">
        <div className="grow">
          <div className="eyebrow">{TABS.find((t) => t.id === tab)?.label}</div>
          <h1>{group.name}</h1>
        </div>
        <button className="me-btn" onClick={() => go('group')} aria-label="Your profile">
          <Avatar p={me} size={38} />
        </button>
      </header>
      <main className={'screen' + (tab === 'map' ? ' full' : '')} key={tab + group.id}>
        {tab === 'feed' && <Feed />}
        {tab === 'map' && <MapScreen />}
        {tab === 'meetups' && <Meetups />}
        {tab === 'group' && <GroupScreen />}
      </main>
      <nav className="tabbar">
        {TABS.map((t) => (
          <button key={t.id} className={'tab' + (tab === t.id ? ' on' : '')} onClick={() => go(t.id)}>
            {Icons[t.id]}
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  )
}

function SetupNeeded() {
  return (
    <div className="center-screen">
      <div className="auth">
        <div className="logo-mark">🔧</div>
        <h1 className="title">Almost ready</h1>
        <p className="muted tagline">
          The app is not connected to its database yet. Add the Supabase URL and public key to <code>.env.local</code> (see{' '}
          <code>.env.example</code>), then restart.
        </p>
      </div>
    </div>
  )
}
