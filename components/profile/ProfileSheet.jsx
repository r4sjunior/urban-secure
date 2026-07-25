/**
 * components/profile/ProfileSheet.jsx
 * Bottom sheet do perfil próprio: estatísticas em cima, edição embaixo.
 *
 * Mesma anatomia do sheet de registro em pages/index.jsx (backdrop + painel
 * + handle de arrastar) — o app já ensinou esse gesto ao usuário, e inventar
 * um segundo padrão de modal aqui só faria a interface parecer remendada.
 */

import { useState, useEffect, useRef } from 'react';
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
  const {
    profile, stats, isLoading, isSaving, isAnchoring, isOnChain,
    saveProfile, anchorProfile, refresh,
  } = useMyProfile();

  // Rascunho local — o formulário não escreve no contexto até salvar, senão
  // fechar o sheet sem salvar deixaria a UI mostrando dados que não foram
  // persistidos.
  const [draft, setDraft] = useState(null);
  const [feedback, setFeedback] = useState(null); // null | 'ok' | mensagem de erro

  // Marca se o usuário já mexeu no formulário nesta abertura.
  //
  // Sem isto, semear o rascunho a cada mudança de `profile` apagava o que
  // estava sendo digitado: basta o perfil recarregar (o fetch inicial
  // terminando, ou um refresh após salvar) para o texto do usuário sumir sem
  // explicação no meio da edição.
  const touched = useRef(false);

  useEffect(() => {
    if (!open) { touched.current = false; return; }

    // Depois do primeiro toque, o rascunho é do usuário e o servidor não
    // manda mais nele até a próxima abertura.
    if (touched.current) return;

    setDraft({
      handle: profile?.handle || '',
      bio: profile?.bio || '',
      avatarUrl: profile?.avatarUrl || '',
      socials: profile?.socials || {},
    });
    setFeedback(null);
  }, [open, profile]);

  if (!open || !draft) return null;

  const set = (patch) => {
    touched.current = true;
    setDraft(d => ({ ...d, ...patch }));
    setFeedback(null);
  };
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

  async function handleAnchor() {
    sound.play('click');
    const result = await anchorProfile();

    if (result.ok) {
      invalidateProfile(address);
      setFeedback(result.created ? 'Perfil gravado no contrato!' : 'Perfil atualizado no contrato!');
      sound.play('success');
    } else {
      setFeedback(result.error);
      sound.play('error');
    }
  }

  // Ancorar depois de editar sem salvar gravaria on-chain o texto ANTIGO — o
  // contexto só conhece o perfil persistido, não o rascunho da tela.
  const rascunhoPendente = touched.current;

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

          {feedback === 'ok' && <div className="transfer-ok">Perfil salvo!</div>}
          {feedback && feedback !== 'ok' && <div className="err-box">{feedback}</div>}

          <button className="mint-cta" onClick={handleSave} disabled={isSaving}>
            {isSaving ? 'Salvando…' : 'Salvar perfil'}
          </button>

          <p className="fee-note">
            Salvar exige só uma assinatura na carteira — sem transação, sem taxa.
          </p>

          {/* Ancoragem no contrato: opcional, e por isso separada do salvar.
              Custa rent, então quem está começando (e ainda não recebeu o
              claim de boas-vindas) não deve ser empurrado para cá. */}
          <div className="claim-rules" style={{ marginTop: 18 }}>
            {isOnChain ? (
              <p className="fee-note">
                Seu perfil está <strong>gravado no contrato</strong>. Ele vale sobre
                qualquer cópia off-chain — só sua carteira consegue alterá-lo.
              </p>
            ) : (
              <>
                <button
                  className="mint-cta ghost"
                  onClick={handleAnchor}
                  disabled={isAnchoring || isSaving || rascunhoPendente}
                >
                  {isAnchoring ? 'Gravando no contrato…' : 'Gravar perfil no contrato'}
                </button>
                <p className="fee-note">
                  {rascunhoPendente
                    ? 'Salve as alterações primeiro — o contrato grava o perfil já salvo.'
                    : 'Opcional. Uma transação (~0.004 SOL de depósito na conta) para o perfil passar a viver on-chain.'}
                </p>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
