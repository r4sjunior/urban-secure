/**
 * components/claim/WelcomeCard.jsx
 * Convite para receber o SOL da primeira arte.
 *
 * Aparece dentro do sheet de claim, ACIMA do claim diário, enquanto a
 * carteira ainda não registrou nada. É a primeira coisa que um usuário novo
 * precisa entender: sem isto, ele veria "registre sua primeira arte para
 * liberar o claim" sem ter como pagar o registro.
 *
 * Quando o perfil ainda está incompleto, o cartão explica o que falta e leva
 * direto à edição — recusar sem indicar o caminho é o que faz o usuário
 * desistir.
 */

import { Gift, UserPen, Loader2, Check } from 'lucide-react';
import { WELCOME_CLAIM_SOL } from '../../lib/config';
import { sound } from '../../lib/sound';

export default function WelcomeCard({ welcome, onEditarPerfil }) {
  const { situacao, isClaiming, error, receber } = welcome;
  if (!situacao) return null;

  // ── Perfil incompleto: o passo anterior ──
  if (!situacao.perfilCompleto) {
    return (
      <div className="welcome-card">
        <span className="welcome-ico"><UserPen className="lucide" /></span>

        <div className="welcome-txt">
          <strong>Complete seu perfil e ganhe {WELCOME_CLAIM_SOL.toFixed(4)} SOL</strong>
          <span>
            É o suficiente para registrar sua primeira arte. Preencha seu nome
            e uma bio curta.
          </span>
        </div>

        <button className="btn-ghost welcome-btn" onClick={onEditarPerfil}>
          Preencher
        </button>
      </div>
    );
  }

  // ── Pronto para receber ──
  return (
    <div className="welcome-card ready">
      <span className="welcome-ico"><Gift className="lucide" /></span>

      <div className="welcome-txt">
        <strong>Bem-vindo! Receba {WELCOME_CLAIM_SOL.toFixed(4)} SOL</strong>
        <span>Para registrar sua primeira arte e liberar o claim diário.</span>
        {error && <span className="welcome-err">{error}</span>}
      </div>

      <button
        className="mint-cta welcome-btn"
        onClick={() => { sound.play('click'); receber(); }}
        disabled={isClaiming}
      >
        {isClaiming
          ? <><Loader2 className="lucide spin" /> Enviando…</>
          : <><Check className="lucide" /> Receber</>}
      </button>
    </div>
  );
}
