import { useEffect, useState, type FormEvent } from 'react'
import QRCode from 'qrcode'
import { supabase } from '../lib/supabase'
import { niceError, useApp } from '../lib/app'
import { t } from '../lib/i18n'
import { useSettings } from '../lib/settings'
import { Avatar, Section } from '../components/ui'
import { StatsCard } from './Stats'
import { BalancesCard } from './Bills'
import { RegionCard } from './Countdowns'
import { BucketList } from './Bucket'
import { SpotsCard } from './Spots'
import { InviteFromFriends } from './Friends'

export const inviteLink = (code: string) => `${window.location.origin}/?join=${code}`

export function GroupScreen() {
  const { group, members, me, reloadGroups, selectGroup, openPerson, isAdmin } = useApp()
  const settings = useSettings()
  const [confirmLeave, setConfirmLeave] = useState(false)

  async function leave() {
    await supabase.from('group_members').delete().eq('group_id', group.id).eq('user_id', me.id)
    setConfirmLeave(false)
    const rest = await reloadGroups()
    if (rest[0]) selectGroup(rest[0].id)
  }

  const sorted = [...members].sort((a, b) => (a.id === me.id ? -1 : b.id === me.id ? 1 : a.display_name.localeCompare(b.display_name)))

  return (
    <>
      {settings.showStats && <StatsCard />}
      <InviteCard />

      <Section title={t('Members · {n}', { n: members.length })}>
        <div className="card list">
          {sorted.map((m) => (
            <button className="list-row" key={m.id} onClick={() => openPerson(m.id)}>
              <Avatar p={m} size={40} dot />
              <span className="grow">
                <span className="name block">
                  {m.display_name}
                  {m.id === me.id && <span className="sub"> ({t('you')})</span>}
                </span>
                <span className="sub block ellipsis">{m.bio || '@' + m.username}</span>
              </span>
              {m.role === 'admin' && <span className="tag">{t('Admin')}</span>}
              <span className="sub">›</span>
            </button>
          ))}
        </div>
      </Section>

      <BucketList />
      <BalancesCard />
      <SpotsCard />

      <Section title={t('Group settings')}>
        <div className="card">
          {isAdmin && <AdminTools />}
          <RegionCard />
        </div>
      </Section>

      <section className="bottom-links">
        {confirmLeave ? (
          <div className="card confirm">
            <p className="name">{t('Leave "{group}"?', { group: group.name })}</p>
            <p className="sub">{t('You can join again later with the invite code.')}</p>
            <div className="row">
              <button className="btn ghost small grow" onClick={() => setConfirmLeave(false)}>
                {t('Stay')}
              </button>
              <button className="btn danger small grow" onClick={leave}>
                {t('Leave')}
              </button>
            </div>
          </div>
        ) : (
          <button className="link danger" onClick={() => setConfirmLeave(true)}>
            {t('Leave this group')}
          </button>
        )}
      </section>
    </>
  )
}

/* ---------------- Invite: code, link, QR ---------------- */

function InviteCard() {
  const { group } = useApp()
  const [copied, setCopied] = useState(false)
  const [qr, setQr] = useState<string | null>(null)
  const [showQr, setShowQr] = useState(false)
  const link = inviteLink(group.invite_code)

  useEffect(() => {
    if (!showQr) return
    QRCode.toDataURL(link, { width: 480, margin: 1, color: { dark: '#1c2131', light: '#ffffff' } })
      .then(setQr)
      .catch(() => setQr(null))
  }, [showQr, link])

  async function share() {
    const text = t('Join "{group}" on friendsapp', { group: group.name })
    try {
      if (navigator.share) {
        await navigator.share({ title: 'friendsapp', text, url: link })
        return
      }
    } catch {
      return // share sheet closed
    }
    try {
      await navigator.clipboard.writeText(`${text}: ${link}`)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* clipboard blocked: the code is visible on screen anyway */
    }
  }

  return (
    <section className="card invite">
      <p className="label">{t('Invite friends')}</p>
      {showQr && qr ? (
        <img className="qr" src={qr} alt={t('QR code to join {group}', { group: group.name })} width={220} height={220} />
      ) : (
        <div className="code">{group.invite_code}</div>
      )}
      <p className="sub">{showQr ? t('Let a friend scan this with their phone camera.') : t('Send the link, show the QR code, or tell them the code.')}</p>
      <div className="row full">
        <button className="btn grow" onClick={share}>
          {copied ? t('Link copied ✓') : t('Share link')}
        </button>
        <button className="btn ghost" onClick={() => setShowQr((s) => !s)}>
          {showQr ? t('Code') : t('QR')}
        </button>
      </div>
      <InviteFromFriends />
    </section>
  )
}

/* ---------------- Admin tools ---------------- */

function AdminTools() {
  const { group, members, me, reloadGroups } = useApp()
  const [name, setName] = useState(group.name)
  const [heir, setHeir] = useState('')
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function run(fn: () => PromiseLike<{ error: { message?: string; code?: string } | null }>, done: string) {
    setBusy(true)
    setMsg('')
    setError('')
    const { error } = await fn()
    await reloadGroups()
    setBusy(false)
    if (error) setError(niceError(error))
    else setMsg(done)
  }

  function rename(e: FormEvent) {
    e.preventDefault()
    if (name.trim() && name.trim() !== group.name) run(() => supabase.from('groups').update({ name: name.trim() }).eq('id', group.id), t('Renamed ✓'))
  }

  const others = members.filter((m) => m.id !== me.id)

  return (
    <div className="stack">
      <form className="stack-s" onSubmit={rename}>
        <label className="name small" htmlFor="group-rename">
          {t('Group name')}
        </label>
        <div className="composer-row">
          <input id="group-rename" className="input grow" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
          <button className="btn small" disabled={busy || !name.trim() || name.trim() === group.name}>
            {t('Save')}
          </button>
        </div>
      </form>
      <div className="stack-s">
        <p className="name small">{t('Invite code')}</p>
        <p className="sub">{t('Make a new code if the old one got around. The old code and link stop working.')}</p>
        <button className="btn ghost small" disabled={busy} onClick={() => run(() => supabase.rpc('new_invite_code', { g: group.id }), t('New code: ready ✓'))}>
          🔄 {t('New invite code')}
        </button>
      </div>
      {others.length > 0 && (
        <div className="stack-s">
          <p className="name small">{t('Pass admin on')}</p>
          <p className="sub">{t('They become admin and you become a normal member.')}</p>
          <div className="composer-row">
            <select id="pass-admin" className="input grow" value={heir} onChange={(e) => setHeir(e.target.value)}>
              <option value="">{t('Choose a member…')}</option>
              {others.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.display_name}
                </option>
              ))}
            </select>
            <button className="btn ghost small" disabled={busy || !heir} onClick={() => run(() => supabase.rpc('pass_admin', { g: group.id, u: heir }), t('Done ✓'))}>
              {t('Pass on')}
            </button>
          </div>
        </div>
      )}
      {msg && <p className="info">{msg}</p>}
      {error && <p className="error">{error}</p>}
      <hr className="divider" />
    </div>
  )
}
