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
        'accent-vif': teinte('accent-vif'),
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
      boxShadow: {
        // Élévation pendant le glisser-déposer : une assise sombre pour la
        // profondeur (un shadow-xl classique reste quasi invisible sur un
        // fond aussi sombre que --fond) + un halo en accent pour que la
        // carte se détache clairement plutôt que par une simple bordure.
        drag: '0 20px 40px -12px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(139, 146, 255, 0.45), 0 0 24px rgba(139, 146, 255, 0.3)',
        // Halo permanent de la recherche : blanc doux, visible même au
        // repos plutôt que réservé au focus — invite à taper sans qu'il
        // faille d'abord toucher le champ pour voir qu'il existe.
        'halo-recherche': '0 0 0 3px rgba(255, 255, 255, 0.28), 0 0 26px rgba(255, 255, 255, 0.30)',
        // Halo au focus : bleu ciel plutôt que blanc, pour distinguer
        // « en train d'y taper » du simple état de repos.
        'halo-recherche-focus': '0 0 0 3px rgba(56, 189, 248, 0.32), 0 0 26px rgba(56, 189, 248, 0.4)',
      },
      fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'] },
    },
  },
}
