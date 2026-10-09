# Pilote réel V1 — Hitza

Statut : proposition de recette sans effet, à revoir après qualification de L5. Ce document
n’autorise aucune installation, activation, écriture Linear, exécution fournisseur, création
de branche distante, PR ou fusion.
## Cible fixée

- Paperclip recette : `http://127.0.0.1:3210`, société **e-ty local**
  `587884dc-195c-4555-8db9-9f3d9541b373`.
- Linear : projet **Hitza** `2554218f-40e6-4283-9b02-d61eaffba8df`, équipe
  `88812287-860b-4764-9eb6-5bc39ac9945d`, <https://linear.app/pezzoslabs/project/hitza-136b6ff01aff>.
- Git : `pezzoslabs/content-assistant`, base locale lue sans modification à
  `main@8677031484a7eb7d84dfcd28d137e093e50d7bad`. Le checkout partagé est derrière son
  origin et ne sera ni actualisé ni utilisé par les agents.
- Le projet Paperclip `f71bdbe1-0940-4d19-8d49-2e08737508a0` et son workspace primaire
  occupé restent inchangés et hors pilote.

## Objets isolés proposés

Créer un nouveau projet Paperclip **Hitza · qualification campagne V1** dont le workspace
primaire est un worktree privé neuf, par exemple
`/home/davy-lp/.paperclip/workspaces/hitza-linear-v1-pilot`. Le créer depuis le SHA fixé
ci-dessus sur `pilot/linear-campaign-v1-2026-10`; pousser cette branche dédiée puis faire
des deux PR leur base. Aucune PR ne cible `main` et aucune autre mission ne partage ce worktree.

Créer une petite milestone Linear **Paperclip V1 — deux livraisons documentaires**, sans
adopter de milestone existante, puis exactement quatre tickets neufs :

1. un ticket campagne hors milestone, passé en Todo seulement au signal de départ ;
2. un parent dans la milestone portant le critère transverse : le check local doit confirmer
   les deux preuves documentaires ensemble sur la tête intégrée ;
3. une feuille A, enfant du parent, ajoutant `docs/paperclip-pilot/source-contract.md` et
   `scripts/check-paperclip-pilot.mjs` ;
4. une feuille B, enfant du parent et bloquée par A, ajoutant
   `docs/paperclip-pilot/readback-contract.md` et complétant le même check pour les deux fichiers.

Le ticket campagne contient le marqueur `linear-milestone-campaign.v1`, l’UUID de la nouvelle
milestone et ces références explicites : PRD `docs/01-product/PRD.md`, version
`8677031484a7eb7d84dfcd28d137e093e50d7bad`, SHA-256
`5e158560e7efbae13a67455998da2a0953a0ad87f733b397bcfe882f806222d4` ; TAD
`docs/02-architecture/TAD.md`, même version, SHA-256
`f6995af0205d1f977e99e5b90468e0f0fa6c8377eb953042a7a61cf7c4c3dd8a`.
Les descriptions du parent et des feuilles reprennent leurs critères, chemins possédés et
commande du check. Les descriptions humaines et relations restent ensuite en lecture seule.

## Parcours et preuves attendues

Après le Todo : lecture complète paginée, import/readback, admission exclusive, publication
relue du plan, PR A revue et fusionnée dans la branche pilote, vérification intégrée, puis le
même parcours pour PR B depuis le commit intégré de A. Le reviewer global indépendant relit
PRD/TAD, parent, deux preuves et sortie du check avant bilan et statuts Linear terminaux.

Conserver : versions/SHAs des deux packages installés, IDs des objets Linear/Paperclip,
empreinte source, mandat, enveloppe et réservations, runs/acteurs, URLs et têtes exactes des
deux PR, commits fusionnés, sortie du check, commentaires/statuts avec readback, verdict et
preuve terminale. A01 n’est réussi que si aucun effet pertinent ne reste inconnu. A02–A08
réutilisent les preuves L1–L5 ; aucun rejeu fournisseur général n’est prévu.

Arrêt immédiat avant l’effet dépendant si L5 n’est pas qualifié, si le gateway réel est
incomplet, si le dépôt est occupé, si la source change, si une publication est inconnue, si
la base avance, si le budget n’est plus admissible ou si une fusion/readback échoue. Pause,
reprise et annulation passent uniquement par les commandes Council prévues et conservent les
identités, consommations et intentions originales.

## Effets exacts à soumettre à approbation après L5

- créer le worktree/branche privée, pousser une seule branche pilote, créer deux PR vers elle,
  publier leurs readbacks et autoriser au plus une fusion de chacune ; aucun droit vers `main` ;
- créer un projet Paperclip isolé, ses sept acteurs bornés (`lead`, A, B, produit, qualité,
  reviewer Council indépendant, publisher), son mandat de chemins et l’occupation du dépôt ;
- installer les deux packages candidats qualifiés, puis activer uniquement cette société,
  ce nouveau projet Paperclip, le projet/équipe Hitza et les quatre tickets du pilote ;
- créer la milestone et les quatre tickets Linear ci-dessus, leurs parenté/dépendance initiales,
  puis autoriser au plugin seulement commentaires et statuts des objets gérés ;
- configurer la connexion `8a672ba5-d93c-41e6-a196-78147924cf6c` seulement après readback,
  le profil lecture `9f222f37-9e0c-46e6-9030-5ba33c879820`, un nouveau client gateway et
  des références natives de secrets ; ne pas réutiliser le client gateway expiré ;
- créer et qualifier séparément un profil publisher à privilèges minimaux ; son existence,
  ses schémas, sa portée commentaires/statuts et son readback sont encore non vérifiés ;
- configurer une enveloppe native proposée de `12 000 000` unités par période et des
  réservations de `2 000 000` par run, **à confirmer par l’utilisateur avant effet**.

Une unité vaut un token natif observé : `inputTokens + outputTokens`; `cachedInputTokens` est
déjà inclus dans l’entrée et n’est pas ajouté deux fois. Les réservations retiennent une
exposition, sans garantir un coût fournisseur maximal. Le plafond proposé couvre deux feuilles,
leurs revues/publications et la revue globale avec arrêt avant dépassement ; il ne vaut ni budget
monétaire ni autorisation implicite.

## Inconnues qui changent les effets

Restent à relever en lecture seule : versions finales L1–L5, IDs du nouveau projet/milestone/
tickets/acteurs/états, références de secrets disponibles, schémas et pagination gateway réels,
droits du profil publisher, état de la connexion, disponibilité de la branche distante et
occupation Council. Les lectures gateway et les écritures commentaire/statut ont deux preuves
de capacité distinctes ; aucune n’est acquise ici.

Modèle conseillé pour les runs ordinaires et la revue finale : `gpt-5.6-sol`, effort `medium`,
à réévaluer vers `high` seulement sur ambiguïté substantielle. Source : mapping indépendant du
5 septembre 2026. Aucun réglage effectif n’est observé ; il reste hérité/inconnu jusqu’au readback
des profils et des runs.
