/**
 * components/claim/ClaimResultModal.jsx
 * Confirmação do claim, com link pro explorer.
 *
 * TOLERANTE A CAMPOS AUSENTES por decisão, não por descuido. Este componente
 * roda logo após uma transação; se a resposta vier incompleta — conexão que
 * caiu, função que excedeu o tempo, reconciliação que sabe que o resgate
 * passou mas não tem a assinatura — um `undefined.toFixed()` derrubaria a
 * aplicação inteira com "client-side exception", logo depois de o usuário ter
 * recebido o SOL. A tela de sucesso não pode ser mais frágil que a operação
 * que ela celebra.
 */

import { Gift, Zap, Flame } from 'lucide-react';

export default function ClaimResultModal({ result, onDismiss }) {
  if (!result) return null;

  const network = process.env.NEXT_PUBLIC_SOLANA_NETWORK || 'devnet';

  // A assinatura falta quando o resultado veio da reconciliação: sabemos que
  // o resgate aconteceu, mas não qual foi a transação.
  const explorerUrl = result.signature
    ? `https://explorer.solana.com/tx/${result.signature}?cluster=${network}`
    : null;

  const valor = Number.isFinite(result.amountSol) ? result.amountSol.toFixed(4) : null;
  const streak = Number.isFinite(result.streak) ? result.streak : null;

  return (
    <div className="claim-result" onClick={onDismiss}>
      <div className="claim-result-card" onClick={e => e.stopPropagation()}>
        <div className={`claim-result-icon${result.completedCycle ? ' bonus' : ''}`}>
          {result.completedCycle ? <Gift className="lucide" /> : <Zap className="lucide" />}
        </div>

        <h3 className="claim-result-title">
          {result.completedCycle ? 'Ciclo completo!' : 'Resgate confirmado'}
        </h3>

        {valor && <p className="claim-result-amount">+{valor} SOL</p>}

        {streak !== null && (
          <p className="claim-result-streak">
            <Flame className="lucide" /> {streak} {streak === 1 ? 'dia seguido' : 'dias seguidos'}
          </p>
        )}

        {result.packAvailable && (
          <div className="claim-result-pack">
            Você ganhou um <strong>pacote de figurinha</strong>. Abra no seu álbum.
          </div>
        )}

        {/* Quando o resultado veio da reconciliação, é honesto dizer que o
            resgate passou mesmo sem termos o comprovante em mãos. */}
        {result.reconciliado && (
          <p className="claim-result-hint">
            A conexão oscilou, mas seu resgate foi registrado.
          </p>
        )}

        {explorerUrl && (
          <a
            className="claim-result-link"
            href={explorerUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            Ver transação no explorer ↗
          </a>
        )}

        <button className="mint-cta" onClick={onDismiss}>Fechar</button>
      </div>
    </div>
  );
}
