import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { niceError, useApp } from '../lib/app'
import { t } from '../lib/i18n'
import { day } from '../lib/time'
import { Section } from '../components/ui'
import type { BucketItem } from '../types'

const EMOJIS = ['✨', '🏎️', '🎢', '🏕️', '✈️', '🎤', '🎳', '🏖️', '⛷️', '🎬', '🍣', '🎆']

/** Things the group wants to do together one day. Tick them off, or plan one with a tap. */
export function BucketList() {
  const { group, me, isAdmin, openNewMeetup } = useApp()
  const [items, setItems] = useState<BucketItem[] | null>(null)
  const [title, setTitle] = useState('')
  const [emoji, setEmoji] = useState('✨')
  const [showDone, setShowDone] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const { data } = await supabase.from('bucket_items').select('*').eq('group_id', group.id).order('created_at')
    setItems((data as BucketItem[]) ?? [])
  }, [group.id])

  useEffect(() => {
    load()
    const ch = supabase
      .channel('bucket-' + group.id)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bucket_items', filter: `group_id=eq.${group.id}` }, load)
      .subscribe()
    return () => {
      supabase.removeChannel(ch)
    }
  }, [group.id, load])

  async function add(e: FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    setError('')
    const { error } = await supabase.from('bucket_items').insert({ group_id: group.id, created_by: me.id, title: title.trim(), emoji })
    if (error) return setError(niceError(error))
    setTitle('')
    setEmoji('✨')
    load()
  }

  async function tick(i: BucketItem) {
    const done_at = i.done_at ? null : new Date().toISOString()
    setItems((prev) => prev?.map((x) => (x.id === i.id ? { ...x, done_at } : x)) ?? prev)
    await supabase.from('bucket_items').update({ done_at }).eq('id', i.id)
  }

  async function remove(i: BucketItem) {
    setItems((prev) => prev?.filter((x) => x.id !== i.id) ?? prev)
    await supabase.from('bucket_items').delete().eq('id', i.id)
  }

  const open = items?.filter((i) => !i.done_at) ?? []
  const done = items?.filter((i) => i.done_at) ?? []

  return (
    <Section title={t('Bucket list')} action={done.length > 0 && <span className="sub tiny">{t('{n} done ✓', { n: done.length })}</span>}>
      <div className="card">
        {items !== null && open.length === 0 && <p className="sub">{t('What do you want to do together one day? Go-karting, a trip, a concert…')}</p>}
        <div className="list">
          {open.map((i) => (
            <div className="bucket-row" key={i.id}>
              <button className="check" onClick={() => tick(i)} aria-label={t('Mark as done')} />
              <span className="bucket-emoji">{i.emoji}</span>
              <span className="grow name small">{i.title}</span>
              <button className="btn ghost tiny-btn" onClick={() => openNewMeetup({ title: i.emoji + ' ' + i.title })}>
                {t('Plan it')}
              </button>
              {(i.created_by === me.id || isAdmin) && (
                <button className="icon-btn faint" aria-label={t('Remove')} onClick={() => remove(i)}>
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
        <form className="composer-row" onSubmit={add}>
          <select className="emoji-select" value={emoji} onChange={(e) => setEmoji(e.target.value)} aria-label={t('Pick an emoji')}>
            {EMOJIS.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
          <input id="bucket-title" className="input grow small-input" maxLength={60} placeholder={t('Add something to do together')} value={title} onChange={(e) => setTitle(e.target.value)} />
          <button className="btn small" disabled={!title.trim()}>
            {t('Add')}
          </button>
        </form>
        {error && <p className="error">{error}</p>}
        {done.length > 0 && (
          <>
            <button className="link inline" onClick={() => setShowDone((s) => !s)}>
              {showDone ? t('Hide done') : t('Show done ({n})', { n: done.length })}
            </button>
            {showDone && (
              <div className="list">
                {done.map((i) => (
                  <div className="bucket-row done" key={i.id}>
                    <button className="check on" onClick={() => tick(i)} aria-label={t('Mark as not done')}>
                      ✓
                    </button>
                    <span className="bucket-emoji">{i.emoji}</span>
                    <span className="grow name small">{i.title}</span>
                    <span className="sub tiny">{day(i.done_at!)}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </Section>
  )
}
