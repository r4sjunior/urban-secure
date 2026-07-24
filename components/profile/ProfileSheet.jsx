/**
 * components/profile/ProfileSheet.jsx
 * Bottom sheet do perfil próprio: estatísticas em cima, edição embaixo.
 *
 * Mesma anatomia do sheet de registro em pages/index.jsx (backdrop + painel
 * + handle de arrastar) — o app já ensinou esse gesto ao usuário, e inventar
 * um segundo padrão de modal aqui só faria a interface parecer remendada.
 */

import { useState, useEffect } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useMyProfile } from '../../context/ProfileContext';
import { invalidateProfile } from '../../lib/hooks/useProfile';
import { BIO_MAX_LENGTH, HANDLE_MAX_LENGTH } from '../../lib/config';
import { shortWallet } from '../../lib/social/profile';
import { sound } from '../../lib/sound';
import AvatarUpload from './AvatarUpload';
import StatsGrid from './StatsGrid';
import { SocialInputs } from './SocialLinks';

export default function ProfileSheet({ open, onClose }) {
  const wallet = useWallet();
  const address = wallet.publicKey?.toBase58() || '';
  const { profile, stats, isLoading, isSaving, saveProfile, refresh } = useMyProfile();

  // Rascunho local — o formulário não escreve no contexto até salvar, senão
  // fechar o sheet sem salvar deixaria a UI mostrando dados que não foram
  // persistidos.
  const [draft, setDraft] = useState(null);
  const [feedback, setFeedback] = useState(null); // null | 'ok' | mensagem de erro

  // Semeia o rascunho quando o sheet abre. A dependência em `profile` cobre
  // o caso de abrir antes do fetch terminar: quando o perfil chega, o
  // formulário se preenche sozinho.
  useEffect(() => {
    if (!open) return;
    setDraft({
      handle: profile?.handle || '',
      bio: profile?.bio || '',
      avatarUrl: profile?.avatarUrl || '',
      socials: profile?.socials || {},
    });
    setFeedback(null);
  }, [open, profile]);

  if (!open || !draft) return null;

  const set = (patch) => { setDraft(d => ({ ...d, ...patch })); setFeedback(null); };
  const bioLeft = BIO_MAX_LENGTH - draft.bio.length;

  async function handleSave() {
    sound.play('click');
    const result = await saveProfile(draft);

    if (result.ok) {
      // O feed e o popup do mapa leem o perfil pelo cache de useProfile;
      // sem invalidar, o avatar novo só apareceria lá depois de 5 minutos.
      invalidateProfile(address);
      setFeedback('ok');
      sound.play('success');
      refresh();
      setTimeout(() => { setFeedback(null); onClose(); }, 900);
    } else {
      setFeedback(result.error);
      sound.play('error');
    }
  }

  return (
    <div className="sheet open profile-sheet">
      <div className="sheet-backdrop" onClick={() => !isSaving && onClose()} />

      <div className="sheet-panel">
        <div className="sheet-handle" onClick={() => !isSaving && onClose()} />

        <h2 className="sheet-title">Seu Perfil</h2>
        <p className="sheet-sub">{shortWallet(address)}</p>

        <StatsGrid stats={stats} isLoading={isLoading} />

        <div className="profile-form">
          <AvatarUpload
            wallet={address}
            handle={draft.handle}
            avatarUrl={draft.avatarUrl}
            onChange={url => set({ avatarUrl: url })}
            disabled={isSaving}
          />

          <input
            className="fld"
            placeholder="Seu nome ou tag"
            value={draft.handle}
            onChange={e => set({ handle: e.target.value })}
            maxLength={HANDLE_MAX_LENGTH}
            disabled={isSaving}
          />

          <div className="fld-wrap">
            <textarea
              className="fld"
              placeholder="Uma linha sobre você e sua arte"
              value={draft.bio}
              onChange={e => set({ bio: e.target.value })}
              rows={3}
              maxLength={BIO_MAX_LENGTH}
              disabled={isSaving}
            />
            <span className={`fld-count${bioLeft <= 20 ? ' low' : ''}`}>{bioLeft}</span>
          </div>

          <span className="form-legend">Redes sociais</span>
          <SocialInputs
            socials={draft.socials}
            onChange={socials => set({ socials })}
            disabled={isSaving}
          />

          {feedback === 'ok' && <div className="transfer-ok">✅ Perfil salvo!</div>}
          {feedback && feedback !== 'ok' && <div className="err-box">⚠️ {feedback}</div>}

          <button className="mint-cta" onClick={handleSave} disabled={isSaving}>
            {isSaving ? '⏳ Salvando…' : '💾 Salvar Perfil'}
          </button>

          <p className="fee-note">
            Salvar exige só uma assinatura na carteira — sem transação, sem taxa.
          </p>
        </div>
      </div>
    </div>
  );
}
