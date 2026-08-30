const teinte = (nom) => `rgb(var(--${nom}) / <alpha-value>)`

export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Couleurs sémantiques adossées aux variables CSS de index.css :
        // le mode sombre s'applique là-bas, une seule fois.
        fond: teinte('fond'),
        carte: teinte('carte'),
        'carte-douce': teinte('carte-douce'),
        texte: teinte('texte'),
        'texte-doux': teinte('texte-doux'),
        'texte-faible': teinte('texte-faible'),
        'texte-fantome': teinte('texte-fantome'),
        separateur: teinte('separateur'),
        bordure: teinte('bordure'),
        accent: teinte('accent'),
        // Valeur fixe (pas une variable CSS) : ce token porte déjà son
        // opacité, contrairement aux autres qui la reçoivent via les
        // modificateurs Tailwind (bg-accent/15).
        'accent-doux': 'rgba(139, 146, 255, 0.14)',
        alerte: teinte('alerte'),
        erreur: teinte('erreur'),
      },
      borderRadius: {
        carte: '16px',
        imbrique: '12px',
      },
      fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'] },
    },
  },
}
