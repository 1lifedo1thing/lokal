import React, { useEffect, useState } from 'react'
import { Check, Plus } from 'lucide-react'
import { discoveryArtistKey, loadDiscoveryArtists, setArtistFollowed, useDiscoveryArtists, validFollowIdentity } from '../discoveryArtists'
import { showToast } from './Toaster'
import { useTranslation } from '../i18n'

/** Follow / Following: a followed artist's releases show in Home → Releases. */
export default function FollowArtistButton({ name, className, catalogueIdentity = null, imageUrl = '' }) {
  const { t } = useTranslation()
  const key = discoveryArtistKey(name)
  const selected = validFollowIdentity({ ...catalogueIdentity, imageUrl })
  const followedByName = useDiscoveryArtists(s => s.followed.has(key))
  const recorded = useDiscoveryArtists(s => s.identities.get(key))
  // Following another similarly named catalogue artist is not equivalent.
  const followed = followedByName && (!selected ||
    (recorded?.catalogue === selected.catalogue && recorded?.artistId === selected.artistId))
  const [busy, setBusy] = useState(false)
  useEffect(() => { loadDiscoveryArtists().catch(() => {}) }, [])
  const toggle = async () => {
    if (busy) return
    setBusy(true)
    try { await setArtistFollowed(name, !followed, selected); showToast(followed ? `Unfollowed ${name}` : `Following ${name}`) }
    catch (error) { showToast(error.message) }
    finally { setBusy(false) }
  }
  return (
    <button disabled={busy || !name} onClick={toggle} className={className} aria-pressed={followed}
      title={t(followed ? 'Unfollow: no more releases from this artist in Home → Releases, and kept out of Discovery' : 'Follow: this artist’s new releases show in Home → Releases')}>
      {followed ? <Check size={12} /> : <Plus size={12} />}{followed ? t('Following') : t('Follow')}
    </button>
  )
}
