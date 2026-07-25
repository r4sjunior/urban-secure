/**
 * components/claim/ClaimSheet.jsx
 * Bottom sheet do claim diário: trilha do streak, botão e explicação.
 *
 * Mesma anatomia dos outros sheets do app. Concentra tudo do claim numa tela
 * só porque o gesto é diário e precisa ser rápido: abrir, ver quanto falta,
 * resgatar, fechar.
 */

import { useState, useEffect } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useClaim } from '../../context/ClaimContext';
import { useMyProfile } from '../../context/ProfileContext';
import { ARTS_PER_CLAIM, STREAK_TARGET, STREAK_BONUS_MULTIPLIER } from '../../lib/config';
import { formatCountdown } from '../../lib/social/claim';
import { sound } from '../../lib/sound';
import { useWelcome } from '../../lib/hooks/useWelcome';
import WelcomeCard from './WelcomeCard';
import StreakTracker from './StreakTracker';
import ClaimButton from './ClaimButton';
import ClaimResultModal from './ClaimResultModal';

export default function ClaimSheet({ open, onClose, onEditarPerfil }) {
  const wallet = useWallet();
  const { status, isLoading, isClaiming, error, lastResult, claim, clearResult, refresh } = useClaim();
  const { refresh: refreshProfile } = useMyProfile();
  const welcome = useWelcome();
  const [localError, setLocalError] = useState(null);

  // Reconsulta ao abrir: o sheet costuma abrir horas depois do último fetch,
  // e um cooldown que já venceu precisa aparecer liberado sem exigir reload.
  useEffect(() => {
    if (open) { refresh(); setLocalError(null); }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  async function handleClaim() {
    const result = await claim();

    if (result.ok) {
      sound.play('success');
      // As stats do perfil (streak, ranking) mudaram com o claim.
      refreshProfile();
      welcome.refresh();
    } else {
      sound.play('error');
      setLocalError(result.error || 'Não foi possível resgatar.');
    }
  }

  const shownError = localError || error;
  const connected = wallet.connected && !!wallet.publicKey;

  return (
    <>
      <div className="sheet open claim-sheet">
        <div className="sheet-backdrop" onClick={() => !isClaiming && onClose()} />

        <div className="sheet-panel">
          <div className="sheet-handle" onClick={() => !isClaiming && onClose()} />

          <h2 className="sheet-title">Claim Diário</h2>
          <p className="sheet-sub">
            SOL da carteira do projeto pra você registrar {ARTS_PER_CLAIM} artes por dia.
          </p>

          {!connected ? (
            <p className="transfer-empty">Conecte sua carteira para resgatar.</p>
          ) : isLoading ? (
            <p className="transfer-empty">Carregando seu streak…</p>
          ) : (
            <>
              {/* Boas-vindas antes de tudo: sem SOL para a primeira arte,
                  o claim diário fica inalcançável e a trilha do streak não
                  significa nada para quem está chegando. */}
              {welcome.mostrar && (
                <WelcomeCard
                  welcome={welcome}
                  onEditarPerfil={() => { onClose(); onEditarPerfil?.(); }}
                />
              )}

              <StreakTracker
                currentStreak={status.currentStreak}
                nextIsClaimable={status.canClaim}
              />

              {/* Aviso de streak em risco. Só aparece na janela em que dá pra
                  agir — antes o usuário não pode claimar, depois já não há o
                  que salvar. */}
              {status.streakAtRisk && (
                <div className="claim-warn">
                  Seu streak de {status.currentStreak}{' '}
                  {status.currentStreak === 1 ? 'dia acaba' : 'dias acaba'} em{' '}
                  <strong>{formatCountdown(status.streakExpiresAt - Date.now())}</strong>
                </div>
              )}

              {status.canClaim && status.willCompleteCycle && (
                <div className="claim-bonus-note">
                  Este resgate fecha o ciclo: paga {STREAK_BONUS_MULTIPLIER}x e libera um pacote de figurinha.
                </div>
              )}

              {shownError && <div className="err-box">{shownError}</div>}

              <ClaimButton
                status={status}
                isClaiming={isClaiming}
                onClaim={handleClaim}
                disabled={!connected}
              />

              <ul className="claim-rules">
                <li>Um resgate a cada <strong>20 horas</strong></li>
                <li>
                  <strong>{STREAK_TARGET} dias seguidos</strong> = resgate dobrado + 1 figurinha
                </li>
                <li>Passou <strong>48h</strong> sem resgatar, o streak zera</li>
              </ul>

              {status.longestStreak > 0 && (
                <p className="fee-note">
                  Seu recorde: {status.longestStreak} dias · {status.totalClaims} resgates
                </p>
              )}
            </>
          )}
        </div>
      </div>

      <ClaimResultModal
        result={lastResult}
        onDismiss={() => { clearResult(); onClose(); }}
      />
    </>
  );
}
