import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { configured, supabase } from './lib/supabase'
import { AppContext, niceError, store, useApp, type AppState, type MeetupDraft, type Tab } from './lib/app'
import { useOnTheWay } from './lib/onTheWay'
import { setBatterySharing, useLiveLocation } from './lib/location'
import { OnlineContext, useOnline } from './lib/presence'
import { privacyOn } from './lib/settings'
import { useSos } from './lib/sos'
import { LANG, t } from './lib/i18n'
import { ago } from './lib/time'
import { Avatar, Icons, Sheet, Splash } from './components/ui'
import { AuthScreen } from './screens/Auth'
import { ProfileSetup } from './screens/ProfileForm'
import { GroupForms, GroupStart } from './screens/GroupStart'
import { Feed } from './screens/Feed'
import { MapScreen } from './screens/MapScreen'
import { Meetups, NewMeetup } from './screens/Meetups'
import { GroupScreen } from './screens/GroupScreen'
import { SettingsScreen } from './screens/Settings'
import { PersonSheet, WaveInbox } from './screens/Waves'
import type { Group, Member, Profile } from './types'

// Invite links look like https://…/?join=ABC123. Remember the code until the person is signed in.
;(() => {
  const params = new URLSearchParams(window.location.search)
  const code = params.get('join')
  if (code && /^[A-Za-z0-9]{6}$/.test(code)) {
    store.set('pendingJoin', code.toUpperCase())
    params.delete('join')
    const rest = params.toString()
    window.history.replaceState(null, '', '/' + (rest ? '?' + rest : ''))
  }
})()

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
  const [muted, setMuted] = useState<Set<string>>(() => new Set())
  const [person, setPerson] = useState<string | null>(null)
  const [joinError, setJoinError] = useState('')
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
    supabase
      .from('mutes')
      .select('muted')
      .eq('user_id', uid)
      .then(({ data }) => data && setMuted(new Set((data as { muted: string }[]).map((r) => r.muted))))
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

  // Remember timezone + language, so notifications come at the right time in the right language
  useEffect(() => {
    if (!me) return
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    const patch: Partial<Profile> = {}
    if (tz && me.timezone !== tz) patch.timezone = tz
    if (me.lang !== undefined && me.lang !== LANG) patch.lang = LANG
    if (Object.keys(patch).length) supabase.from('profiles').update(patch).eq('id', me.id).then(() => {})
  }, [me])

  useEffect(() => {
    setBatterySharing(privacyOn(me?.privacy, 'battery'))
  }, [me?.privacy])

  const selectGroup = useCallback((id: string) => {
    setGroupId(id)
    store.set('groupId', id)
  }, [])

  // Load groups, then use a pending invite link if there is one
  useEffect(() => {
    if (!hasProfile) return
    ;(async () => {
      await reloadGroups()
      const code = store.get('pendingJoin')
      if (!code) return
      store.remove('pendingJoin')
      const { data, error } = await supabase.rpc('join_group', { code })
      if (error) return setJoinError(niceError(error))
      await reloadGroups()
      selectGroup((data as Group).id)
      goTab('feed')
    })()
  }, [hasProfile, reloadGroups, selectGroup, goTab])

  const group = groups?.find((g) => g.id === groupId) ?? groups?.[0]
  const gid = group?.id

  // Members of the open group, kept live
  useEffect(() => {
    if (!gid) return
    let alive = true
    const load = async () => {
      const { data } = await supabase.from('group_members').select('role, profiles(*)').eq('group_id', gid)
      if (!alive) return
      const rows = (data ?? []) as unknown as { role: Member['role']; profiles: Profile | null }[]
      // Not in the list any more (left on another device, or removed by an admin): switch groups
      if (!rows.some((r) => r.profiles?.id === uid)) return void reloadGroups()
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
  }, [gid, uid, reloadGroups])

  const toggleMute = useCallback(
    async (id: string) => {
      const on = !muted.has(id)
      setMuted((prev) => {
        const next = new Set(prev)
        if (on) next.add(id)
        else next.delete(id)
        return next
      })
      if (on) await supabase.from('mutes').insert({ user_id: uid, muted: id })
      else await supabase.from('mutes').delete().eq('user_id', uid).eq('muted', id)
    },
    [muted, uid],
  )

  if (me === undefined) return <Splash />
  if (me === null) return <ProfileSetup userId={uid} onDone={setMe} />
  if (groups === undefined) return <Splash />
  if (!group)
    return (
      <GroupStart
        error={joinError}
        onDone={async (g) => {
          await reloadGroups()
          selectGroup(g.id)
        }}
      />
    )

  return (
    <SignedInShell
      base={{
        session,
        me,
        setMe,
        groups,
        group,
        selectGroup,
        reloadGroups,
        members,
        goTab,
        openNewMeetup: (d) => setDraft(d ?? {}),
        openPerson: setPerson,
        muted,
        toggleMute,
        isAdmin: members.some((m) => m.id === me.id && m.role === 'admin'),
      }}
      tab={tab}
      person={person}
      closePerson={() => setPerson(null)}
      draft={draft}
      closeDraft={() => setDraft(null)}
    />
  )
}

/** Adds the live parts (online friends, SOS) and renders the app. */
function SignedInShell({
  base,
  tab,
  person,
  closePerson,
  draft,
  closeDraft,
}: {
  base: Omit<AppState, 'sos'>
  tab: Tab
  person: string | null
  closePerson: () => void
  draft: MeetupDraft | null
  closeDraft: () => void
}) {
  const online = useOnline(base.group.id, base.me.id, privacyOn(base.me.privacy, 'online'))
  const sos = useSos(base.group.id, base.me.id)
  const state: AppState = { ...base, sos }
  const p = person ? (base.members.find((m) => m.id === person) ?? (person === base.me.id ? base.me : null)) : null

  return (
    <AppContext.Provider value={state}>
      <OnlineContext.Provider value={online}>
        <Shell tab={tab} />
        <WaveInbox />
        {p && <PersonSheet person={p} onClose={closePerson} />}
        {draft && <NewMeetup draft={draft} onClose={closeDraft} onCreated={() => base.goTab('meetups')} />}
      </OnlineContext.Provider>
    </AppContext.Provider>
  )
}

const TABS: { id: Tab; label: string }[] = [
  { id: 'feed', label: 'Feed' },
  { id: 'map', label: 'Map' },
  { id: 'meetups', label: 'Meetups' },
  { id: 'group', label: 'Group' },
  { id: 'me', label: 'You' },
]

function Shell({ tab }: { tab: Tab }) {
  const { me, group, groups, goTab: go } = useApp()
  const [switching, setSwitching] = useState(false)
  useLiveLocation(me.id, me.location_mode)
  useOnTheWay(me.id)

  const title = tab === 'me' ? t('Settings') : group.name

  return (
    <div className="app">
      <header className="topbar">
        {tab === 'me' ? (
          <h1 className="grow">{title}</h1>
        ) : (
          <button className="group-switch grow" onClick={() => setSwitching(true)} aria-label={t('Switch group')}>
            <span className="eyebrow">{t(TABS.find((x) => x.id === tab)?.label ?? '')}</span>
            <span className="group-title">
              <span className="ellipsis">{group.name}</span>
              {groups.length > 1 && <span className="chev">▾</span>}
            </span>
          </button>
        )}
      </header>
      <SosBanner />
      <main className={'screen' + (tab === 'map' ? ' full' : '')} key={tab + group.id}>
        {tab === 'feed' && <Feed />}
        {tab === 'map' && <MapScreen />}
        {tab === 'meetups' && <Meetups />}
        {tab === 'group' && <GroupScreen />}
        {tab === 'me' && <SettingsScreen />}
      </main>
      <nav className="tabbar">
        {TABS.map((x) => (
          <button key={x.id} className={'tab' + (tab === x.id ? ' on' : '')} onClick={() => go(x.id)} aria-current={tab === x.id ? 'page' : undefined}>
            {x.id === 'me' ? (
              <span className="tab-avatar">
                <Avatar p={me} size={20} />
              </span>
            ) : (
              Icons[x.id as keyof typeof Icons]
            )}
            {t(x.label)}
          </button>
        ))}
      </nav>
      {switching && <GroupSwitcher onClose={() => setSwitching(false)} />}
    </div>
  )
}

function GroupSwitcher({ onClose }: { onClose: () => void }) {
  const { groups, group, selectGroup, reloadGroups } = useApp()
  const [adding, setAdding] = useState(false)
  return (
    <Sheet title={t('Your groups')} onClose={onClose}>
      <div className="stack">
        <div className="list">
          {groups.map((g) => (
            <button
              className={'list-row' + (g.id === group.id ? ' on' : '')}
              key={g.id}
              onClick={() => {
                selectGroup(g.id)
                onClose()
              }}
            >
              <span className="grow name">{g.name}</span>
              {g.id === group.id ? <span className="tag">{t('Open')}</span> : <span className="sub">›</span>}
            </button>
          ))}
        </div>
        {adding ? (
          <GroupForms
            onDone={async (g) => {
              await reloadGroups()
              selectGroup(g.id)
              onClose()
            }}
          />
        ) : (
          <button className="btn ghost block" onClick={() => setAdding(true)}>
            + {t('Join or create a group')}
          </button>
        )}
      </div>
    </Sheet>
  )
}

function SosBanner() {
  const { sos, members, me, goTab } = useApp()
  const byId = useMemo(() => new Map(members.map((m) => [m.id, m])), [members])
  if (!sos.alerts.length) return null
  return (
    <div className="sos-banners">
      {sos.alerts.map((a) =>
        a.user_id === me.id ? (
          <div className="sos-banner" key={a.id}>
            <span className="grow">
              <b>🆘 {t('Your SOS is on')}</b>
              <span className="block tiny">{t('Your group sees where you are until you end it.')}</span>
            </span>
            <button className="btn small light" onClick={sos.end}>
              {t("I'm OK")}
            </button>
          </div>
        ) : (
          <div className="sos-banner" key={a.id}>
            <span className="grow">
              <b>🆘 {t('{name} needs help', { name: byId.get(a.user_id)?.display_name ?? t('A friend') })}</b>
              <span className="block tiny">{ago(a.created_at)}</span>
            </span>
            <button className="btn small light" onClick={() => goTab('map')}>
              {t('Show on map')}
            </button>
          </div>
        ),
      )}
    </div>
  )
}

function SetupNeeded() {
  return (
    <div className="center-screen">
      <div className="auth">
        <div className="logo-mark">🔧</div>
        <h1 className="title">{t('Almost ready')}</h1>
        <p className="muted tagline">
          The app is not connected to its database yet. Add the Supabase URL and public key to <code>.env.local</code> (see <code>.env.example</code>), then restart.
        </p>
      </div>
    </div>
  )
}
