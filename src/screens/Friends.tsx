import { useContext, useEffect, useRef, useState, type FormEvent } from 'react'
import QRCode from 'qrcode'
import { supabase } from '../lib/supabase'
import { AppContext, niceError, store, useApp } from '../lib/app'
import { t, tn, LOCALE } from '../lib/i18n'
import { addFriend, addLink, endFriendship, useFriends, type Card, type FriendRow, type GroupInvite, type NearbyPerson, type Suggestion } from '../lib/friends'
import { Avatar, Section, Sheet } from '../components/ui'
import { birthdayText } from './Waves'
import type { Group, Profile } from '../types'

/** The Friends card at the top of the You tab. */
export function FriendsCard() {
  const { friends } = useApp()
  const list = (friends.rows ?? []).filter((r) => r.state === 'friend')
  return (
    <Section title={t('Friends')}>
      <button className="card friends-card" onClick={friends.open}>
        {list.length > 0 ? (
          <span className="avatar-stack">
            {list.slice(0, 4).map((f) => (
              <Avatar key={f.id} p={f} size={34} />
            ))}
          </span>
        ) : (
          <span className="friends-card-icon">🤝</span>
        )}
        <span className="grow">
          <span className="name block">{list.length ? tn(list.length, '{n} friend', '{n} friends') : t('Add your friends')}</span>
          <span className="sub block">
            {friends.waiting > 0 ? tn(friends.waiting, '{n} request waiting for you', '{n} requests waiting for you') : t('Nearby, QR code or @username')}
          </span>
        </span>
        {friends.waiting > 0 && <span className="count-badge">{friends.waiting}</span>}
        <span className="sub">›</span>
      </button>
    </Section>
  )
}

export type FriendsView = View
type View = { name: 'main' } | { name: 'nearby' } | { name: 'qr' } | { name: 'friend'; id: string }

export function FriendsSheet({ onClose, start }: { onClose: () => void; start?: View }) {
  const { friends } = useApp()
  const [view, setView] = useState<View>(start ?? { name: 'main' })
  const back = () => setView({ name: 'main' })
  const friend = view.name === 'friend' ? friends.rows?.find((r) => r.id === view.id) : undefined

  const title =
    view.name === 'nearby' ? t('Add nearby') : view.name === 'qr' ? t('My QR code') : view.name === 'friend' ? (friend?.display_name ?? t('Friends')) : t('Friends')

  return (
    <Sheet title={title} onClose={onClose}>
      {view.name !== 'main' && (
        <button className="link inline back-link" onClick={back}>
          ‹ {t('Friends')}
        </button>
      )}
      {view.name === 'main' && <Main open={setView} onClose={onClose} />}
      {view.name === 'nearby' && <Nearby />}
      {view.name === 'qr' && <MyQr />}
      {view.name === 'friend' && (friend ? <FriendView f={friend} onRemoved={back} /> : <p className="sub">{t('Not friends any more.')}</p>)}
    </Sheet>
  )
}

function Main({ open, onClose }: { open: (v: View) => void; onClose: () => void }) {
  const { me, friends } = useApp()
  const rows = friends.rows ?? []
  const incoming = rows.filter((r) => r.state === 'incoming')
  const outgoing = rows.filter((r) => r.state === 'outgoing')
  const list = rows.filter((r) => r.state === 'friend').sort((a, b) => a.display_name.localeCompare(b.display_name))

  return (
    <div className="stack">
      {friends.invites.length > 0 && (
        <Section title={t('Group invites')}>
          <GroupInviteList invites={friends.invites} onJoined={onClose} />
        </Section>
      )}

      {incoming.length > 0 && (
        <Section title={t('Friend requests')}>
          <div className="card list">
            {incoming.map((r) => (
              <div className="list-row" key={r.id}>
                <Avatar p={r} size={40} />
                <span className="grow">
                  <span className="name block ellipsis">{r.display_name}</span>
                  <span className="sub block ellipsis">@{r.username}</span>
                </span>
                <AddButton person={r} />
                <button className="icon-btn" aria-label={t('Say no')} onClick={() => endFriendship(me.id, r.id).then(friends.reload)}>
                  ✕
                </button>
              </div>
            ))}
          </div>
        </Section>
      )}

      <div className="add-tiles">
        <button className="add-tile" onClick={() => open({ name: 'nearby' })}>
          <span className="add-tile-icon">📡</span>
          <span className="name small">{t('Add nearby')}</span>
          <span className="sub tiny">{t('Friend next to you')}</span>
        </button>
        <button className="add-tile" onClick={() => open({ name: 'qr' })}>
          <span className="add-tile-icon">🔳</span>
          <span className="name small">{t('My QR code')}</span>
          <span className="sub tiny">{t('Let them scan it')}</span>
        </button>
      </div>

      <Search />
      <Suggestions />

      <Section title={list.length ? tn(list.length, '{n} friend', '{n} friends') : t('Your friends')}>
        {friends.rows === null ? (
          <p className="sub">{t('Loading…')}</p>
        ) : list.length === 0 ? (
          <div className="empty">
            <div className="empty-icon">🤝</div>
            {t('No friends added yet. Start with someone next to you: both open Add nearby.')}
          </div>
        ) : (
          <div className="card list">
            {list.map((f) => (
              <button className="list-row" key={f.id} onClick={() => open({ name: 'friend', id: f.id })}>
                <Avatar p={f} size={40} />
                <span className="grow">
                  <span className="name block ellipsis">{f.display_name}</span>
                  <span className="sub block ellipsis">@{f.username}</span>
                </span>
                <span className="sub">›</span>
              </button>
            ))}
          </div>
        )}
      </Section>

      {outgoing.length > 0 && (
        <Section title={t('Sent requests')}>
          <div className="card list">
            {outgoing.map((r) => (
              <div className="list-row" key={r.id}>
                <Avatar p={r} size={36} />
                <span className="grow">
                  <span className="name block ellipsis">{r.display_name}</span>
                  <span className="sub block ellipsis">{t('Waiting for an answer')}</span>
                </span>
                <button className="btn ghost tiny-btn" onClick={() => endFriendship(me.id, r.id).then(friends.reload)}>
                  {t('Cancel')}
                </button>
              </div>
            ))}
          </div>
        </Section>
      )}

      <p className="sub tiny center privacy-note">🔒 {t('Friends see your profile, not your location. Your location is only shared inside groups.')}</p>
    </div>
  )
}

/** Add / Sent / Accept / Friends, depending on where you stand with this person. */
function AddButton({ person }: { person: Card }) {
  const { me, friends } = useApp()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const state = friends.rows?.find((r) => r.id === person.id)?.state
  if (person.id === me.id) return <span className="tag">{t('You')}</span>
  if (state === 'friend') return <span className="tag ok-tag">{t('Friends ✓')}</span>
  if (state === 'outgoing') return <span className="tag soft-tag">{t('Sent ✓')}</span>

  async function go() {
    setBusy(true)
    setError('')
    const { error } = await addFriend(person.id)
    if (error) setError(niceError(error))
    await friends.reload()
    setBusy(false)
  }
  return (
    <span className="add-btn-wrap">
      <button className="btn tiny-btn" onClick={go} disabled={busy}>
        {state === 'incoming' ? t('Accept') : t('Add')}
      </button>
      {error && <span className="error tiny">{error}</span>}
    </span>
  )
}

function PersonRow({ p, sub }: { p: Card; sub?: string }) {
  return (
    <div className="list-row">
      <Avatar p={p} size={40} />
      <span className="grow">
        <span className="name block ellipsis">{p.display_name}</span>
        <span className="sub block ellipsis">{sub ?? '@' + p.username}</span>
      </span>
      <AddButton person={p} />
    </div>
  )
}

function Search() {
  const [q, setQ] = useState('')
  const [found, setFound] = useState<Card | null | undefined>(undefined)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function search(e: FormEvent) {
    e.preventDefault()
    if (!q.trim()) return
    setBusy(true)
    setError('')
    const { data, error } = await supabase.rpc('find_user', { q: q.trim() })
    setBusy(false)
    if (error) return setError(niceError(error))
    setFound((data as Card | null) ?? null)
  }

  return (
    <div className="stack-s">
      <form className="row" onSubmit={search}>
        <input
          className="input"
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setFound(undefined)
          }}
          placeholder={t('@username')}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          maxLength={40}
          aria-label={t('Find by username')}
        />
        <button className="btn ghost" disabled={busy || !q.trim()}>
          {t('Find')}
        </button>
      </form>
      {error && <p className="error">{error}</p>}
      {found === null && <p className="sub">{t('Nobody found. Check the spelling: it has to be the exact @username.')}</p>}
      {found && (
        <div className="card list">
          <PersonRow p={found} />
        </div>
      )}
    </div>
  )
}

function Suggestions() {
  const { friends } = useApp()
  const [list, setList] = useState<Suggestion[]>([])
  useEffect(() => {
    if (friends.demo) return setList(friends.demo.suggestions)
    supabase.rpc('friend_suggestions').then(({ data }) => setList((data as Suggestion[] | null) ?? []))
    // Load once per opening, so people you just added don't jump around
  }, [friends.demo])
  if (!list.length) return null
  return (
    <Section title={t('People you may know')}>
      <div className="card list">
        {list.slice(0, 8).map((s) => (
          <PersonRow
            key={s.id}
            p={s}
            sub={s.via ? t('In {group}', { group: s.via }) : tn(s.mutual, '{n} friend in common', '{n} friends in common')}
          />
        ))}
      </div>
    </Section>
  )
}

function Nearby() {
  const { me, friends } = useApp()
  const [people, setPeople] = useState<NearbyPerson[] | null>(null)
  const [error, setError] = useState('')
  const pos = useRef<GeolocationPosition | null>(null)

  useEffect(() => {
    if (friends.demo) return setPeople(friends.demo.nearby)
    if (!navigator.geolocation) return setError(t("This device can't share its location."))
    let alive = true
    const ping = async () => {
      const p = pos.current
      if (!p || document.hidden) return
      const { data, error } = await supabase.rpc('nearby_ping', {
        lat: p.coords.latitude,
        lng: p.coords.longitude,
        acc: Math.round(p.coords.accuracy),
      })
      if (!alive) return
      if (error) return setError(niceError(error))
      setError('')
      setPeople((data as NearbyPerson[] | null) ?? [])
    }
    const watch = navigator.geolocation.watchPosition(
      (p) => {
        const first = !pos.current
        pos.current = p
        if (first) ping()
      },
      (e) =>
        setError(
          e.code === 1
            ? t("Allow location to use Add nearby. It's only used while this screen is open.")
            : t("Can't find your location right now. Try again outside or near a window."),
        ),
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 },
    )
    const timer = setInterval(ping, 4000)
    return () => {
      alive = false
      navigator.geolocation.clearWatch(watch)
      clearInterval(timer)
      supabase.rpc('nearby_stop').then(() => {})
    }
  }, [friends.demo])

  return (
    <div className="stack">
      <div className={'radar' + (error ? ' off' : '')}>
        <span className="radar-ring" />
        <span className="radar-ring two" />
        <Avatar p={me} size={64} />
      </div>
      <p className="sub center">{t('Ask your friend to open Add nearby too. Only people who have this screen open right now can see you.')}</p>
      {error ? (
        <p className="error center">{error}</p>
      ) : people === null ? (
        <p className="sub center">{t('Finding your location…')}</p>
      ) : people.length === 0 ? (
        <p className="sub center">{t('Looking for people nearby…')}</p>
      ) : (
        <div className="card list">
          {people.map((p) => (
            <PersonRow key={p.id} p={p} sub={t('About {m} m away', { m: Math.max(5, Math.round(p.meters / 5) * 5) })} />
          ))}
        </div>
      )}
    </div>
  )
}

function MyQr() {
  const { me } = useApp()
  const [qr, setQr] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const link = addLink(me.id)

  useEffect(() => {
    QRCode.toDataURL(link, { width: 480, margin: 1, color: { dark: '#1c2131', light: '#ffffff' } })
      .then(setQr)
      .catch(() => setQr(null))
  }, [link])

  async function share() {
    const text = t('Add me on friendsapp')
    try {
      if (navigator.share) {
        await navigator.share({ title: 'friendsapp', text, url: link })
        return
      }
    } catch {
      return
    }
    try {
      await navigator.clipboard.writeText(`${text}: ${link}`)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* clipboard blocked */
    }
  }

  return (
    <div className="stack my-qr">
      <div className="my-qr-head">
        <Avatar p={me} size={48} />
        <span>
          <span className="name block">{me.display_name}</span>
          <span className="sub block">@{me.username}</span>
        </span>
      </div>
      {qr ? <img className="qr" src={qr} alt={t('Your personal QR code')} width={220} height={220} /> : <div className="qr" />}
      <p className="sub center">{t('Your friend scans this with their phone camera and can add you.')}</p>
      <button className="btn block" onClick={share}>
        {copied ? t('Link copied ✓') : t('Share my link')}
      </button>
    </div>
  )
}

function FriendView({ f, onRemoved }: { f: FriendRow; onRemoved: () => void }) {
  const { me, groups, friends } = useApp()
  const [full, setFull] = useState<Profile | null>(null)
  const [confirm, setConfirm] = useState(false)

  useEffect(() => {
    if (friends.demo) return
    supabase
      .from('profiles')
      .select('*')
      .eq('id', f.id)
      .maybeSingle()
      .then(({ data }) => setFull(data as Profile | null))
  }, [f.id, friends.demo])

  async function remove() {
    await endFriendship(me.id, f.id)
    await friends.reload()
    onRemoved()
  }

  return (
    <div className="stack">
      <div className="friend-head">
        <Avatar p={full ?? f} size={72} />
        <span className="name big">{f.display_name}</span>
        <span className="sub">@{f.username}</span>
        {full?.bio && <p className="friend-bio">{full.bio}</p>}
        <span className="sub tiny">
          {full?.birthday && <>🎂 {birthdayText(full.birthday)} · </>}
          {t('Friends since {date}', { date: new Date(f.since).toLocaleDateString(LOCALE, { day: 'numeric', month: 'long', year: 'numeric' }) })}
        </span>
      </div>

      <Section title={t('Invite to a group')}>
        <div className="card list">
          {groups.map((g) => (
            <InviteRow key={g.id} g={g} friendId={f.id} />
          ))}
        </div>
        <p className="sub tiny">{t('They get asked first. Nobody joins a group without saying yes.')}</p>
      </Section>

      {confirm ? (
        <div className="confirm danger">
          <p className="name">{t('Remove {name} as a friend?', { name: f.display_name })}</p>
          <p className="sub">{t("They won't be told. You stay together in the groups you share.")}</p>
          <div className="row">
            <button className="btn ghost small grow" onClick={() => setConfirm(false)}>
              {t('Cancel')}
            </button>
            <button className="btn danger small grow" onClick={remove}>
              {t('Remove')}
            </button>
          </div>
        </div>
      ) : (
        <button className="link danger" onClick={() => setConfirm(true)}>
          {t('Remove friend')}
        </button>
      )}
    </div>
  )
}

function InviteRow({ g, friendId }: { g: Group; friendId: string }) {
  const [state, setState] = useState<'idle' | 'busy' | 'sent'>('idle')
  const [error, setError] = useState('')
  async function invite() {
    setState('busy')
    setError('')
    const { error } = await supabase.rpc('invite_friend', { g: g.id, other: friendId })
    if (error) {
      setState('idle')
      return setError(niceError(error))
    }
    setState('sent')
  }
  return (
    <div className="list-row">
      <span className="group-dot">{g.name.slice(0, 1).toUpperCase()}</span>
      <span className="grow">
        <span className="name block ellipsis">{g.name}</span>
        {error && <span className="error tiny block">{error}</span>}
      </span>
      {state === 'sent' ? (
        <span className="tag soft-tag">{t('Invited ✓')}</span>
      ) : (
        <button className="btn ghost tiny-btn" onClick={invite} disabled={state === 'busy'}>
          {t('Invite')}
        </button>
      )}
    </div>
  )
}

/** Group tab: invite friends who aren't in this group yet. */
export function InviteFromFriends() {
  const { friends, members, group } = useApp()
  const [open, setOpen] = useState(false)
  const inGroup = new Set(members.map((m) => m.id))
  const list = (friends.rows ?? []).filter((r) => r.state === 'friend' && !inGroup.has(r.id))
  if (!list.length) return null
  if (!open)
    return (
      <button className="link inline" onClick={() => setOpen(true)}>
        🤝 {tn(list.length, 'Invite from your friends ({n})', 'Invite from your friends ({n})')}
      </button>
    )
  return (
    <div className="list invite-friends">
      {list.map((f) => (
        <FriendInviteRow key={f.id} f={f} groupId={group.id} />
      ))}
    </div>
  )
}

function FriendInviteRow({ f, groupId }: { f: Card; groupId: string }) {
  const [state, setState] = useState<'idle' | 'busy' | 'sent'>('idle')
  const [error, setError] = useState('')
  async function invite() {
    setState('busy')
    setError('')
    const { error } = await supabase.rpc('invite_friend', { g: groupId, other: f.id })
    if (error) {
      setState('idle')
      return setError(niceError(error))
    }
    setState('sent')
  }
  return (
    <div className="list-row">
      <Avatar p={f} size={36} />
      <span className="grow">
        <span className="name block ellipsis">{f.display_name}</span>
        {error && <span className="error tiny block">{error}</span>}
      </span>
      {state === 'sent' ? (
        <span className="tag soft-tag">{t('Invited ✓')}</span>
      ) : (
        <button className="btn ghost tiny-btn" onClick={invite} disabled={state === 'busy'}>
          {t('Invite')}
        </button>
      )}
    </div>
  )
}

/** "Lea invited you to The Squad" with Join / No. Works without AppContext (also on the start screen). */
export function GroupInviteList({ invites, onJoined, reload }: { invites: GroupInvite[]; onJoined: (groupId: string) => void; reload?: () => Promise<void> }) {
  const app = useOptionalApp()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  async function answer(inv: GroupInvite, yes: boolean) {
    setBusy(inv.group_id)
    setError('')
    const { error } = await supabase.rpc('answer_group_invite', { g: inv.group_id, yes })
    setBusy(null)
    if (error) return setError(niceError(error))
    await (reload ?? app?.friends.reload)?.()
    if (yes) {
      if (app) {
        await app.reloadGroups()
        app.selectGroup(inv.group_id)
        app.goTab('feed')
      }
      onJoined(inv.group_id)
    }
  }

  return (
    <div className="stack-s">
      {invites.map((inv) => (
        <div className="card group-invite" key={inv.group_id}>
          <div className="row">
            <Avatar p={inv.invited_by} size={40} />
            <span className="grow">
              <span className="name block">{t('{name} invited you to {group}', { name: inv.invited_by.display_name, group: inv.group_name })}</span>
              <span className="sub block">{tn(inv.members, '{n} member', '{n} members')}</span>
            </span>
          </div>
          <div className="row">
            <button className="btn ghost small grow" onClick={() => answer(inv, false)} disabled={busy === inv.group_id}>
              {t('No thanks')}
            </button>
            <button className="btn small grow" onClick={() => answer(inv, true)} disabled={busy === inv.group_id}>
              {t('Join')}
            </button>
          </div>
        </div>
      ))}
      {error && <p className="error">{error}</p>}
    </div>
  )
}

/** Like useApp, but null on the start screen (before the person is in any group). */
function useOptionalApp() {
  return useContext(AppContext)
}

/** Opened from someone's personal link (/?add=<id>): "Add Lea as a friend?" */
export function AddFromLink({ meId, id, onDone }: { meId: string; id: string; onDone: () => void }) {
  const [card, setCard] = useState<Card | null | undefined>(undefined)
  const [state, setState] = useState<'idle' | 'busy' | 'pending' | 'friends'>('idle')
  const [error, setError] = useState('')

  useEffect(() => {
    supabase.rpc('profile_card', { u: id }).then(({ data, error }) => {
      if (error) setError(niceError(error))
      setCard((data as Card | null) ?? null)
    })
  }, [id])

  async function add() {
    setState('busy')
    const { state, error } = await addFriend(id)
    if (error) {
      setState('idle')
      return setError(niceError(error))
    }
    setState(state ?? 'pending')
  }

  const title = t('Add a friend')
  return (
    <Sheet title={title} onClose={onDone}>
      <div className="stack">
        {card === undefined && !error ? (
          <p className="sub">{t('Loading…')}</p>
        ) : !card ? (
          <p className="error">{error || t('This link is not valid any more.')}</p>
        ) : id === meId ? (
          <div className="friend-head">
            <Avatar p={card} size={72} />
            <p className="sub">{t("That's your own QR code 🙂")}</p>
          </div>
        ) : (
          <>
            <div className="friend-head">
              <Avatar p={card} size={72} />
              <span className="name big">{card.display_name}</span>
              <span className="sub">@{card.username}</span>
            </div>
            {state === 'friends' ? (
              <p className="info center">{t('You and {name} are now friends 🎉', { name: card.display_name })}</p>
            ) : state === 'pending' ? (
              <p className="info center">{t('Request sent. {name} just has to say yes.', { name: card.display_name })}</p>
            ) : (
              <button className="btn block big-btn" onClick={add} disabled={state === 'busy'}>
                {t('Add {name} as a friend', { name: card.display_name })}
              </button>
            )}
            {error && <p className="error">{error}</p>}
          </>
        )}
        <button className="btn ghost block" onClick={onDone}>
          {state === 'pending' || state === 'friends' ? t('Done') : t('Not now')}
        </button>
      </div>
    </Sheet>
  )
}

/** On the start screen (no group yet): group invites from friends, and an opened "add me" link. */
export function StartExtras({ meId, onJoined }: { meId: string; onJoined: (groupId: string) => void }) {
  const friends = useFriends(meId, () => {})
  const [adding, setAdding] = useState<string | null>(() => store.get('pendingAdd'))
  return (
    <>
      {friends.invites.length > 0 && <GroupInviteList invites={friends.invites} onJoined={onJoined} reload={friends.reload} />}
      {adding && (
        <AddFromLink
          meId={meId}
          id={adding}
          onDone={() => {
            store.remove('pendingAdd')
            setAdding(null)
          }}
        />
      )}
    </>
  )
}
