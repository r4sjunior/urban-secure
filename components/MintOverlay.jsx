/**
 * components/MintOverlay.jsx — overlay full-screen 3D durante o mint.
 */
const STEPS = [
  { key: 'upload-image', icon: '🖼️', label: 'Upload da Imagem',     sub: 'Enviando ao IPFS' },
  { key: 'upload-meta',  icon: '📄', label: 'Upload dos Metadados', sub: 'Gravando coordenadas GPS' },
  { key: 'minting',      icon: '⛓️', label: 'Mint na Solana',       sub: 'Assine na sua carteira' },
];

export default function MintOverlay({ visible, step, error, result, onDismiss }) {
  if (!visible) return null;
  const isSuccess = step === 'success';
  const idx = STEPS.findIndex(s => s.key === step);

  return (
    <div className="ov-backdrop">
      <div className="ov-card">
        <div className="ov-glow" />
        <div className="ov-title">
          {error ? '❌ Falha no Mint' : isSuccess ? '🎉 Arte Registrada!' : '🎨 Mintando…'}
        </div>

        {!error && !isSuccess && (
          <div className="ov-steps">
            {STEPS.map((s, i) => {
              const done = i < idx;
              const active = s.key === step;
              return (
                <div key={s.key} className={`ov-step ${done?'done':''} ${active?'active':''}`}>
                  <div className={`ov-step-icon ${active?'spin':''}`}>{done?'✅':active?'⏳':s.icon}</div>
                  <div className="ov-step-txt">
                    <span className="ov-step-label">{s.label}</span>
                    {active && <span className="ov-step-sub">{s.sub}</span>}
                  </div>
                  <div className={`ov-step-bar ${done?'done':''} ${active?'active':''}`} />
                </div>
              );
            })}
          </div>
        )}

        {isSuccess && (
          <>
            <p className="ov-msg ok">Sua obra está na blockchain Solana, na sua carteira! 🎨</p>
            <div className="ov-tip">
              <strong>Não vê na Phantom?</strong> Os NFTs ficam na aba <em>Collectibles</em>.
              Pode levar alguns minutos para a imagem carregar. Confira no explorer:
            </div>
            {result?.explorerUrl && (
              <div className="ov-links">
                <a href={result.explorerUrl} target="_blank" rel="noreferrer">🔍 Explorer</a>
                <a href={result.solscanUrl} target="_blank" rel="noreferrer">📊 Solscan</a>
              </div>
            )}
          </>
        )}

        {error && <p className="ov-msg err">{error}</p>}

        {!isSuccess && !error && <div className="ov-spinner" />}

        {(isSuccess || error) && (
          <button className="ov-btn" onClick={onDismiss}>
            {error ? '🔄 Tentar novamente' : '✨ Registrar outra'}
          </button>
        )}
      </div>
    </div>
  );
}
