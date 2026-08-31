import React, { useState } from 'react'
import { supabase } from '../lib/supabaseClient'

// Facultatif et consulté seulement le jour d'une livraison/installation —
// pas de ligne vide qui traîne comme les autres champs de la fiche tant que
// rien n'est saisi : juste un lien pour l'ajouter au besoin. Une fois
// renseigné, une ligne condensée n'affiche que ce qui est effectivement
// rempli ; un appui dessus rouvre les trois champs pour corriger.
export const formaterAcces = ({ etage, ascenseur, digicode }) => {
  const parties = []
  if (etage) parties.push(etage)
  if (ascenseur === true) parties.push('ascenseur')
  if (ascenseur === false) parties.push("pas d'ascenseur")
  if (digicode) parties.push(`digicode ${digicode}`)
  return parties.join(', ')
}

const OPTIONS_ASCENSEUR = [
  [true, 'Ascenseur'],
  [false, "Pas d'ascenseur"],
  [null, 'Non renseigné'],
]

// Enregistre directement en base à la confirmation, plutôt que de passer par
// le formulaire principal (dirty/Enregistrer) : ce n'est pas un champ qu'on
// laisse à moitié saisi en attendant d'enregistrer le reste de la fiche —
// même logique que TexteModifiable ailleurs sur cette fiche.
export default function AccesCabinet({ client, onEnregistre }) {
  const [edition, setEdition] = useState(false)
  const [brouillon, setBrouillon] = useState(null)
  const [enCours, setEnCours] = useState(false)

  const resume = formaterAcces(client)

  const ouvrir = () => {
    setBrouillon({
      etage: client.etage ?? '',
      ascenseur: client.ascenseur ?? null,
      digicode: client.digicode ?? '',
    })
    setEdition(true)
  }

  const enregistrer = async () => {
    setEnCours(true)
    const update = {
      etage: brouillon.etage.trim() || null,
      ascenseur: brouillon.ascenseur,
      digicode: brouillon.digicode.trim() || null,
    }
    const { data, error } = await supabase
      .from('clients')
      .update(update)
      .eq('id', client.id)
      .select()
      .single()
    setEnCours(false)
    if (error) return
    onEnregistre(data)
    setEdition(false)
  }

  if (!edition) {
    return (
      <div className="px-4 py-3">
        <label className="block text-xs text-texte-doux">Accès</label>
        {resume ? (
          <button onClick={ouvrir} className="block text-left w-full text-texte">
            {resume}
          </button>
        ) : (
          <button onClick={ouvrir} className="text-accent text-sm h-9 -ml-1 px-1">
            + Ajouter l'accès
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="px-4 py-3 space-y-3">
      <p className="text-xs text-texte-doux">Accès</p>
      <div>
        {/* Un placeholder seul se lisait comme une valeur déjà remplie plutôt
            qu'une invite à saisir (retour terrain) : un label permanent,
            comme sur le reste de la fiche, lève l'ambiguïté même une fois
            le champ rempli. */}
        <label className="text-xs text-texte-doux" htmlFor="acces-cabinet-etage">
          Étage
        </label>
        <input
          id="acces-cabinet-etage"
          value={brouillon.etage}
          onChange={(e) => setBrouillon((b) => ({ ...b, etage: e.target.value }))}
          placeholder="ex. 3ème, RDC"
          autoComplete="off"
          name="acces-cabinet-etage"
          className="w-full bg-carte-douce rounded-imbrique px-2 py-1.5 text-texte outline-none placeholder:text-texte-fantome"
        />
      </div>
      <div className="flex gap-2">
        {OPTIONS_ASCENSEUR.map(([valeur, libelle]) => (
          <button
            key={String(valeur)}
            onClick={() => setBrouillon((b) => ({ ...b, ascenseur: valeur }))}
            className={`flex-1 text-xs py-1.5 rounded-imbrique ${
              brouillon.ascenseur === valeur
                ? 'bg-accent text-white font-semibold'
                : 'bg-carte-douce text-texte-doux'
            }`}
          >
            {libelle}
          </button>
        ))}
      </div>
      <div>
        <label className="text-xs text-texte-doux" htmlFor="acces-cabinet-digicode">
          Digicode
        </label>
        <input
          id="acces-cabinet-digicode"
          value={brouillon.digicode}
          onChange={(e) => setBrouillon((b) => ({ ...b, digicode: e.target.value }))}
          placeholder="—"
          autoComplete="off"
          name="acces-cabinet-digicode"
          className="w-full bg-carte-douce rounded-imbrique px-2 py-1.5 text-texte outline-none placeholder:text-texte-fantome"
        />
      </div>
      <div className="flex justify-end gap-3 pt-1">
        <button onClick={() => setEdition(false)} className="text-texte-fantome text-sm h-9 px-1">
          Annuler
        </button>
        <button
          onClick={enregistrer}
          disabled={enCours}
          className="text-accent text-sm font-semibold h-9 px-1 disabled:opacity-40"
        >
          {enCours ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </div>
    </div>
  )
}
