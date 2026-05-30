/**
 * components/MintOverlay.jsx
 *
 * Overlay full-screen que bloqueia a UI durante o mint,
 * mostrando claramente as 3 etapas com feedback visual.
 *
 * Props:
 *   visible   boolean           — mostra/oculta o overlay
 *   step      string|null       — etapa ativa: 'upload-image' | 'upload-meta' | 'minting' | 'success'
 *   error     string|null       — mensagem de erro (exibe estado de falha)
 *   onDismiss () => void        — chamado ao clicar em "Tentar novamente" ou "Fechar"
 */

const STEPS = [
  {
    key:   'upload-image',
    icon:  '🖼️',
    label: 'Upload da Imagem',
    sub:   'Enviando para o IPFS via Pinata',
  },
  {
    key:   'upload-meta',
    icon:  '📄',
    label: 'Upload dos Metadados',
    sub:   'Gravando coordenadas GPS e atributos',
  },
  {
    key:   'minting',
    icon:  '⛓️',
    label: 'Mint na Solana',
    sub:   'Assine a transação na sua carteira',
  },
];

export default function MintOverlay({ visible, step, error, onDismiss }) {
  if (!visible) return null;

  const isSuccess  = step === 'success';
  const currentIdx = STEPS.findIndex(s => s.key === step);

  return (
    <div className="overlay-backdrop">
      <div className="overlay-card">

        {/* Título */}
        <div className="overlay-title">
          {error      ? '❌ Falha no Mint'      :
           isSuccess  ? '🎉 NFT Mintado!'        :
                        '🎨 Mintando sua Arte…'}
        </div>

        {/* Barra de steps */}
        {!error && (
          <div className="overlay-steps">
            {STEPS.map((s, i) => {
              const isDone   = isSuccess || i < currentIdx;
              const isActive = !isSuccess && s.key === step;

              return (
                <div key={s.key} className="overlay-step-row">

                  {/* Linha conectora */}
                  {i > 0 && (
                    <div className={`overlay-connector ${isDone ? 'done' : ''}`} />
                  )}

                  <div className={`overlay-step ${isDone ? 'done' : ''} ${isActive ? 'active' : ''}`}>

                    {/* Ícone / spinner */}
                    <div className={`overlay-step-icon ${isActive ? 'spinning' : ''}`}>
                      {isDone ? '✅' : isActive ? '⏳' : s.icon}
                    </div>

                    {/* Texto */}
                    <div className="overlay-step-text">
                      <span className="overlay-step-label">{s.label}</span>
                      {isActive && (
                        <span className="overlay-step-sub">{s.sub}</span>
                      )}
                    </div>

                    {/* Indicador de status */}
                    <div className={`overlay-step-status ${isDone ? 'done' : ''} ${isActive ? 'active' : ''}`}>
                      {isDone ? 'OK' : isActive ? '…' : ''}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Mensagem de sucesso */}
        {isSuccess && (
          <p className="overlay-success-msg">
            Sua obra está registrada permanentemente na blockchain Solana.
          </p>
        )}

        {/* Mensagem de erro */}
        {error && (
          <p className="overlay-error-msg">{error}</p>
        )}

        {/* Spinner global (abaixo dos steps) durante processo */}
        {!isSuccess && !error && (
          <div className="overlay-spinner-wrap">
            <div className="overlay-spinner" />
          </div>
        )}

        {/* Botão de ação — só aparece em sucesso ou erro */}
        {(isSuccess || error) && (
          <button className="overlay-btn" onClick={onDismiss}>
            {error ? '🔄 Tentar novamente' : '✅ Fechar'}
          </button>
        )}
      </div>
    </div>
  );
}
