import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useApp } from '../lib/app'
import { Avatar, Sheet } from '../components/ui'
import { LocationModePicker } from '../components/LocationMode'
import { ProfileForm } from './ProfileForm'
import { GroupForms } from './GroupStart'
import { StatsCard } from './Stats'
import { BalancesCard } from './Bills'
import { WaveSheet } from './Waves'
import { NotificationsCard } from './Notifications'
import { RegionCard } from './Countdowns'
import type { Member } from '../types'

export function GroupScreen() {
  const { group, groups, selectGroup, members, me, setMe, reloadGroups } = useApp()
  const [copied, setCopied] = useState(false)
  const [editing, setEditing] = useState(false)
  const [adding, setAdding] = useState(false)
  const [confirmLeave, setConfirmLeave] = useState(false)
  const [waveTo, setWaveTo] = useState<Member | null>(null)

  async function invite() {
    const text = `Join "${group.name}" on friendsapp with code ${group.invite_code}`
    const url = window.location.origin
    try {
      if (navigator.share) {
        await navigator.share({ title: 'friendsapp', text, url })
        return
      }
    } catch {
      return // share sheet closed
    }
    try {
      await navigator.clipboard.writeText(`${text}\n${url}`)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* clipboard blocked: the code is visible on screen anyway */
    }
  }

  async function leave() {
    await supabase.from('group_members').delete().eq('group_id', group.id).eq('user_id', me.id)
    setConfirmLeave(false)
    const rest = await reloadGroups()
    if (rest[0]) selectGroup(rest[0].id)
  }

  const sorted = [...members].sort((a, b) => (a.id === me.id ? -1 : b.id === me.id ? 1 : a.display_name.localeCompare(b.display_name)))

  return (
    <>
      <StatsCard />
      <section className="card invite">
        <p className="label">Invite code</p>
        <div className="code">{group.invite_code}</div>
        <button className="btn block" onClick={invite}>
          {copied ? 'Copied ✓' : 'Invite friends'}
        </button>
      </section>

      <section className="stack-s">
        <p className="label">Members · {members.length}</p>
        <div className="card list">
          {sorted.map((m) => (
            <div className="row" key={m.id}>
              <Avatar p={m} size={40} />
              <div className="grow">
                <div className="name">
                  {m.display_name}
                  {m.id === me.id && <span className="sub"> (you)</span>}
                </div>
                <div className="sub">@{m.username}</div>
              </div>
              {m.role === 'admin' && <span className="tag">Admin</span>}
              {m.id !== me.id && (
                <button className="icon-btn" aria-label={`Wave at ${m.display_name}`} onClick={() => setWaveTo(m)}>
                  👋
                </button>
              )}
            </div>
          ))}
        </div>
      </section>

      <BalancesCard />

      <section className="stack-s">
        <p className="label">Your groups</p>
        <div className="card list">
          {groups.map((g) => (
            <button className={'row group-pick' + (g.id === group.id ? ' on' : '')} key={g.id} onClick={() => selectGroup(g.id)}>
              <span className="grow name">{g.name}</span>
              {g.id === group.id ? <span className="tag">Open</span> : <span className="sub">Switch ›</span>}
            </button>
          ))}
          <button className="btn ghost small" onClick={() => setAdding(true)}>
            + Join or create a group
          </button>
        </div>
      </section>

      <section className="stack-s">
        <p className="label">You</p>
        <div className="card">
          <div className="row">
            <Avatar p={me} size={48} />
            <div className="grow">
              <div className="name">{me.display_name}</div>
              <div className="sub">@{me.username}</div>
            </div>
            <button className="btn ghost small" onClick={() => setEditing(true)}>
              Edit
            </button>
          </div>
        </div>
      </section>

      <section className="stack-s">
        <p className="label">Location sharing</p>
        <div className="card">
          <LocationModePicker />
        </div>
      </section>

      <NotificationsCard />
      <RegionCard />

      <section className="stack-s bottom-links">
        {confirmLeave ? (
          <div className="card">
            <p className="name">Leave "{group.name}"?</p>
            <p className="sub">You can join again later with the invite code.</p>
            <div className="row">
              <button className="btn ghost small grow" onClick={() => setConfirmLeave(false)}>
                Stay
              </button>
              <button className="btn danger small grow" onClick={leave}>
                Leave
              </button>
            </div>
          </div>
        ) : (
          <button className="link danger" onClick={() => setConfirmLeave(true)}>
            Leave this group
          </button>
        )}
        <button className="link" onClick={() => supabase.auth.signOut()}>
          Sign out
        </button>
      </section>

      {editing && (
        <Sheet title="Edit profile" onClose={() => setEditing(false)}>
          <ProfileForm
            userId={me.id}
            existing={me}
            onSaved={(p) => {
              setMe(p)
              setEditing(false)
            }}
          />
        </Sheet>
      )}
      {waveTo && <WaveSheet to={waveTo} onClose={() => setWaveTo(null)} />}
      {adding && (
        <Sheet title="Add a group" onClose={() => setAdding(false)}>
          <GroupForms
            onDone={async (g) => {
              await reloadGroups()
              selectGroup(g.id)
              setAdding(false)
            }}
          />
        </Sheet>
      )}
    </>
  )
}
