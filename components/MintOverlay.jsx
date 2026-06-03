/**
 * components/MintOverlay.jsx — overlay full-screen 3D durante o mint.
 */
const STEPS = [
  { key: 'upload-image', icon: '🖼️', label: 'Upload da Imagem',     sub: 'Enviando ao IPFS' },
  { key: 'upload-meta',  icon: '📄', label: 'Upload dos Metadados', sub: 'Gravando coordenadas GPS' },
  { key: 'minting',      icon: '⛓️', label: 'Mint na Solana',       sub: 'Assine na sua carteira' },
];

export default function MintOverlay({ visible, step, error, onDismiss }) {
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

        {!error && (
          <div className="ov-steps">
            {STEPS.map((s, i) => {
              const done = isSuccess || i < idx;
              const active = !isSuccess && s.key === step;
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

        {isSuccess && <p className="ov-msg ok">Sua obra está na blockchain Solana, na sua carteira.</p>}
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
