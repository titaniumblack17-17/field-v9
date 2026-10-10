#!/bin/bash
# Usage : scripts/suite-repetee.sh <passages valides voulus> <largeur> [étiquette]
# Lance la suite complète jusqu'à obtenir N passages VALIDES (serveur de dev dédié, journal DIAG dans /tmp/diag).
# Un passage est invalide si une AUTRE suite Playwright (autre session, autre dossier) a tourné pendant ce temps :
# toutes les sessions partagent la même base, leurs fixtures et leurs totaux se mélangent.
# Résumé : /tmp/diag/<étiquette>-resume.txt
N=${1:-10}; LARGEUR=${2:-390}; ETQ=${3:-w$LARGEUR}
mkdir -p /tmp/diag; : > /tmp/diag/$ETQ-resume.txt
etrangeres() { ps -eo pid,command | grep -E 'bin/playwright test|workerProcessEntry' | grep -v grep | grep -v 'playwright.repete.config' | grep -v "/Users/brucedasilva/field-v9/node_modules/playwright/lib/worker" ; }
valides=0; essai=0
while [ $valides -lt $N ] && [ $essai -lt $((N*3)) ]; do
  essai=$((essai+1))
  # Attendre qu'aucune autre suite ne tourne (30 min maximum)
  attente=0; while [ -n "$(etrangeres)" ] && [ $attente -lt 360 ]; do sleep 5; attente=$((attente+1)); done
  : > /tmp/diag/$ETQ-etrangeres.tmp
  ( while true; do etrangeres >> /tmp/diag/$ETQ-etrangeres.tmp; sleep 3; done ) &
  ECH=$!
  DIAG=1 DIAG_RUN=$ETQ-$essai LARGEUR=$LARGEUR npx playwright test -c playwright.repete.config.js --timeout=60000 > /tmp/diag/$ETQ-$essai.txt 2>&1
  kill $ECH 2>/dev/null; wait $ECH 2>/dev/null
  resume="$(grep -E '^  [0-9]+ (passed|failed)' /tmp/diag/$ETQ-$essai.txt | tr '\n' ' ')"
  if [ -s /tmp/diag/$ETQ-etrangeres.tmp ]; then
    echo "essai $essai : INVALIDE (autre suite concurrente) : $resume" >> /tmp/diag/$ETQ-resume.txt
    sort -u /tmp/diag/$ETQ-etrangeres.tmp | head -3 | cut -c1-150 | sed 's/^/      /' >> /tmp/diag/$ETQ-resume.txt
  else
    valides=$((valides+1))
    echo "passage valide $valides (essai $essai) : $resume" >> /tmp/diag/$ETQ-resume.txt
    grep -E '^\s+✘' /tmp/diag/$ETQ-$essai.txt | sed 's/^/    /' >> /tmp/diag/$ETQ-resume.txt
  fi
done
echo FIN >> /tmp/diag/$ETQ-resume.txt
