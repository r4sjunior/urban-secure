/**
 * components/claim/ClaimResultModal.jsx
 * Confirmação do claim, com link pro explorer.
 *
 * O link não é enfeite: o app promete que o SOL vem de uma carteira real na
 * devnet, e a assinatura é a prova disso. Poder conferir na hora é o que
 * separa "o app disse que pagou" de "a chain mostra que pagou".
 */

export default function ClaimResultModal({ result, onDismiss }) {
  if (!result) return null;

  const network = process.env.NEXT_PUBLIC_SOLANA_NETWORK || 'devnet';
  const explorerUrl = `https://explorer.solana.com/tx/${result.signature}?cluster=${network}`;

  return (
    <div className="claim-result" onClick={onDismiss}>
      <div className="claim-result-card" onClick={e => e.stopPropagation()}>
        <div className={`claim-result-icon${result.completedCycle ? ' bonus' : ''}`}>
          {result.completedCycle ? <Gift className="lucide" /> : <Zap className="lucide" />}
        </div>

        <h3 className="claim-result-title">
          {result.completedCycle ? 'Ciclo completo!' : 'Resgate confirmado'}
        </h3>

        <p className="claim-result-amount">+{result.amountSol.toFixed(4)} SOL</p>

        <p className="claim-result-streak">
          <Flame className="lucide" /> {result.streak} {result.streak === 1 ? 'dia seguido' : 'dias seguidos'}
        </p>

        {result.packAvailable && (
          <div className="claim-result-pack">
            Você ganhou um <strong>pacote de figurinha</strong>. Abra no seu álbum.
          </div>
        )}

        <a
          className="claim-result-link"
          href={explorerUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          Ver transação no explorer ↗
        </a>

        <button className="mint-cta" onClick={onDismiss}>Fechar</button>
      </div>
    </div>
  );
}
