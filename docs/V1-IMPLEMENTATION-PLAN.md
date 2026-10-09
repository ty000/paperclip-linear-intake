# Plan d’implémentation — V1 Linear / Paperclip

9 octobre 2026 · Sources : [PRD v0.3](PRD.md), [TAD draft v0.2](TAD.md).

**Statut au 9 octobre 2026 : L0 et les lots source L1–L4 sont proposés en PR ;
L5 est en qualification intégrée isolée. L6 est préparé, non exécuté.**
Voir le [raccordement V1](V1-CONNECTION.md) et le [pilote proposé](qualification/V1-PILOT.md).
Les PR restent à fusionner dans leur ordre de dépendance ; leur publication ne vaut
ni mise à niveau de recette ni qualification du gateway réel.

| Livraison proposée | PR dépendantes, dans l'ordre |
| --- | --- |
| Intake : raccordement, import milestone, publication/revalidation | [#11](https://github.com/ty000/paperclip-linear-intake/pull/11) → [#12](https://github.com/ty000/paperclip-linear-intake/pull/12) → [#13](https://github.com/ty000/paperclip-linear-intake/pull/13) |
| Council : contrôles, occupation du dépôt, réception, livraisons sérielles | [#79](https://github.com/ty000/paperclip-council/pull/79) → [#80](https://github.com/ty000/paperclip-council/pull/80) → [#81](https://github.com/ty000/paperclip-council/pull/81) → [#82](https://github.com/ty000/paperclip-council/pull/82) |
Ce plan précise la réalisation
de la V1 ; il ne rouvre pas son périmètre et ne transforme pas les fonctions
reportées en prérequis. Le [plan historique](IMPLEMENTATION-PLAN.md) reste inchangé.
Ce document n’autorise ni modifications dans Council, ni accès opérationnel, ni
activation : ces effets devront être couverts par le lot effectivement lancé.

## 1. Objectif et ordre de passage

**Objectif parent :** une milestone préparée, engagée depuis Linear, donne lieu à
deux livraisons sérielles dans Paperclip/Council, avec commentaires de suivi,
preuves d’intégration, revue globale et clôture confirmée. Une exception produit
un arrêt compréhensible. Il n’y a qu’une campagne active par dépôt.

**Verdict de découpage : `split required`.** Deux plugins indépendants évoluent,
et une preuve en test isolé ne remplace pas le pilote réel. Le premier lot réduit
les inconnues ; cinq lots de code construisent le parcours ; le dernier vérifie
son utilisation réelle. Les refus et reprises sont testés dans chaque lot qui
possède l’effet, sans attendre une phase générale de durcissement.

| Lot | Résultat observable | Dépôt propriétaire des changements | Dépendance | Unité de revue prévue |
| --- | --- | --- | --- | --- |
| L0 | Raccordement V1 et capacités nécessaires identifiés | Intégration, documents seulement ; autres sources en lecture | PRD/TAD fusionnés dans `f720ff6` | Note courte et contrats proposés, sans runtime |
| L1 | Council réserve un dépôt et contrôle une campagne V1 | Council | L0 : contrat et écarts Council résolus | 1 PR de contrôle/admission |
| L2 | Une milestone exacte devient une source/import complet | Intégration | L0 : lecture ; L1 : interface du receveur | 1 PR de lecture/import |
| L3 | Council obtient des publications Linear vérifiées | Intégration | L0 : publication ; L1 et L2 | 1 PR de publication/revalidation |
| L4 | Deux livraisons avancent une par une avec leur propre PR | Council | L1–L3 | 1 PR de séquencement des livraisons |
| L5 | La couverture globale et la publication autorisent la clôture | Council | L4 et publication L3 | 1 PR de clôture et preuve intégrée isolée |
| L6 | Le pilote réel démontre la V1 et ses limites | Recette ; preuves dans l’intégration | L1–L5 qualifiés et cible autorisée | Compte rendu de recette, sans refonte |

Ordre recommandé : **L0 → L1 → L2 → L3 → L4 → L5 → L6**. Ne pas paralléliser les
implémentations avant fixation du contrat. Un lot peut être découpé en deux PR
cohérentes si son diff l’exige ; cela ne crée pas de nouvelle fonctionnalité.
Une PR fournisseur fusionnée est un prérequis utilisable, pas une preuve que le
parcours entre les deux plugins fonctionne déjà.

## 2. Bases inspectées et responsabilités

| Surface | Révision observée pour ce plan | Responsabilité / sources |
| --- | --- | --- |
| Intégration | `main` à `f720ff6d7c1b585054b64158acd1da64edc92489`, paquet `0.4.0` | [Contrat Todo](TODO-INTAKE-CONTRACT.md), [handoff](COUNCIL-HANDOFF-V1.md), `src/source-family.ts`, `src/import-plan.ts`, `src/council-handoff-contract.ts`, journaux et gateway. |
| Council | `main` distant à `91b4e583abf6e1b47796a4501f07e9953175c670`, paquet `0.7.26` | Admission, contrôle, budget, livraisons et verdict. Sources lues par révision distante, sans modifier le checkout documentaire local. |
| Paperclip | Checkout `codex/council-feasibility`, `61b3fd57a695614dc4a37e2303f426a34a9795cf` | SDK et services comme références ; core, SDK, configuration et travaux locaux hors écriture. |
| Linear / Git / fournisseur | Aucune cible opérationnelle interrogée pour ce plan | Effets externes réservés à une qualification explicitement bornée. Le connecteur Codex ne prouve pas le catalogue Paperclip. |

Le checkout local Council est sur `codex/product-prd-roadmap` à `365809e`, avec
des fichiers hors lot. Il ne doit pas être utilisé comme base d’implémentation
ni actualisé de force. Chaque lot de code partira d’un worktree isolé et d’une
base courante vérifiée dans son dépôt. Les versions ci-dessus sont des observations
datées, pas des contraintes de maintien sur une ancienne version.

L’inspection révèle des réutilisations et des écarts concrets :

| Observation source | Conséquence pour le découpage |
| --- | --- |
| Intake lit un sous-arbre et son handoff strict accepte les étapes `preparation` / `admission`. | L2 doit représenter une vraie milestone ; L3 doit permettre la revalidation aux décisions ultérieures. Ne pas fabriquer des relations parent/enfant Linear. |
| Le snapshot actuel inclut notamment états et `updatedAt`. | L2/L3 distinguent l’empreinte matérielle du périmètre et les observations de progression, sinon le plugin pourrait se bloquer sur ses propres écritures. |
| Council possède déjà un journal de publications, un challenge de source, des reçus et des contrôles avant départ. | Réutiliser `linear-continuity-*`, sans second transport ni deuxième comptabilité. |
| Le contrat Council attend trois capacités de continuité ; son contrôle traite des commandes Linear et son annulation peut fermer une PR. | L0/L1 déterminent le sous-ensemble V1 supporté. Ne pas annoncer des capacités non réalisées ni activer implicitement les comportements reportés. |
| L’intégration hiérarchique Council produit un candidat final commun. | L4 doit prouver une livraison/PR par feuille ; la présence de cette hiérarchie ne suffit pas. |
| La consolidation de complétion existe déjà. | L5 réutilise ses preuves, mais doit établir le verdict global indépendant et attendre la publication Linear. |
| SDK déclaré intake `2026.1005.0`, Council `2026.916.1`. | Vérifier la paire sur le host de test ; ne pas lancer une mise à niveau générale des dépendances par réflexe. |

Références Council vérifiées :
[contrat de continuité](https://github.com/ty000/paperclip-council/blob/91b4e583abf6e1b47796a4501f07e9953175c670/src/linear-continuity-contract.ts),
[transport et reçus](https://github.com/ty000/paperclip-council/blob/91b4e583abf6e1b47796a4501f07e9953175c670/src/linear-continuity-transport.ts),
[contrôles](https://github.com/ty000/paperclip-council/blob/91b4e583abf6e1b47796a4501f07e9953175c670/src/linear-continuity-control.ts),
[annulation](https://github.com/ty000/paperclip-council/blob/91b4e583abf6e1b47796a4501f07e9953175c670/src/linear-continuity-cancellation.ts),
[intégration hiérarchique](https://github.com/ty000/paperclip-council/blob/91b4e583abf6e1b47796a4501f07e9953175c670/src/hierarchy-integration.ts),
[complétion](https://github.com/ty000/paperclip-council/blob/91b4e583abf6e1b47796a4501f07e9953175c670/src/completion-runtime.ts).
Ces lectures ne sont pas une nouvelle preuve d’installation ou d’exécution.

## 3. Lots détaillés

### L0 — Fixer le raccordement minimal

**But :** choisir les opérations et les deux échanges nécessaires avant de coder
leurs deux extrémités. Couvre les [questions Q1–Q4](TAD-QUESTIONS.md), sans audit
général de l’écosystème ni nouvelle phase de cadrage produit.

- Établir une petite matrice : opération V1, outil/surface existant, schéma ou
  preuve consultée, manque, lot propriétaire. Séparer lecture et écriture.
- Fixer le format du ticket de campagne, la représentation native de la milestone,
  la référence de source et la politique de continuité V1. Le ticket reste hors
  de la milestone ; la racine technique native ne modifie pas la parenté Linear.
- Choisir la réutilisation du protocole Council courant ou son extension bornée ;
  spécifier source/revalidation et publication/résultat, avec exemples bons/refusés.
  Le propriétaire du contrat source/publication est l’intégration ; Council possède
  l’autorité et la consommation. Les deux côtés doivent accepter les mêmes exemples.
- Identifier le chemin de commandes Paperclip, l’acquisition exclusive du dépôt
  et le contrôle qui empêche le nettoyage automatique des PR pour cette V1.
- Décrire le pilote de deux livraisons et un critère transversal. Les IDs de cible,
  autorisations et budget manquants restent explicitement « à fournir » pour L6.

**Écritures prévues :** une note de capacité et les précisions contractuelles utiles
dans `docs/` de l’intégration ; aucune source Council ni appel externe implicite.
Une inspection réelle du gateway exige cible, société, profil et portée read-only
autorisés. Sans cela, la partie statique continue et la preuve réelle reste ouverte.

**Fin vérifiable :** chaque opération est disponible, absente ou non prouvée ; chaque
manque a un propriétaire et une conséquence sur L1–L6. Aucun nom d’outil inventé.
Le contrat entre plugins est assez précis pour écrire ses fixtures. Les parties
indépendantes peuvent avancer sur fixtures ; une liaison au gateway non vérifiée
ne peut être déclarée utilisable ni activée. Si un manque impose de changer produit,
frontière de dépôt ou architecture, arrêter cette décision et présenter l’écart.

**Hors lot :** implémentation, catalogue exhaustif, écritures Linear, installation,
exécutions fournisseur et effets Git externes. **Preuve :** matrice sourcée et exemples de contrat ; pas un
rapport affirmant que les quatre questions sont résolues sans accès aux faits.

### L1 — Préparer Council pour une campagne V1 exclusive

**Dépendance :** contrat et réutilisation Council décidés en L0. **Dépôt :** Council.

**Inclus :**

- Accepter la source de campagne derrière une option désactivée, en conservant le
  chemin Todo historique ; empêcher toute admission tant que ses conditions manquent.
- Conserver identité de campagne, source fixée, phase et occupation durable du dépôt
  dans les états existants ou leur extension minimale. Brancher l’exclusion sur
  tous les chemins d’admission vers le dépôt, pas seulement l’entrée milestone.
- Adapter la continuité existante à la V1 : commandes dans Paperclip, suspension
  en cas de source matérielle différente et aucune adoption automatique de contexte.
  L’annulation conserve les PR ouvertes pour traitement humain. Ces limites V1
  ne changent pas les politiques des anciennes missions déjà configurées.
- Réutiliser les contrôles avant départ/fusion/clôture, le budget et les points sûrs.
  Une pause en préparation reprend en préparation ; un redémarrage ne libère pas
  le dépôt et une réponse incertaine ne réinitialise pas les identités.
- Consommer le contrat de publication proposé sans prétendre disposer déjà du
  publisher réel : tant que son reçu manque, le travail dépendant reste retenu.

**Surfaces candidates :** `src/project-task-intake.ts`, `src/admission.ts`,
`src/project-mandate-guard.ts`, `src/linear-intake-*`, `src/linear-continuity-*`,
tests correspondants ; migration privée Council uniquement si nécessaire.

**Fin vérifiable :** deux admissions concurrentes sur un dépôt ne donnent qu’un
propriétaire, y compris ticket ponctuel contre campagne ; après restart, même
propriétaire et budget. Une pause/annulation bloque les nouveaux effets, conserve
ceux déjà envoyés et n’appelle pas `cancel-pr`. Aucun run ne démarre avec une source
ou publication manquante. Ces cas passent sur tests unitaires et stockage approprié.

**Couverture :** M02, M03, M06, M07, M08, M10 ; A02, A04, A05, A08.
**Hors lot :** vrai gateway, séquence complète des livraisons, revue globale et
modification du core. Si l’exclusion native est insuffisante, ajouter seulement
l’acquisition durable manquante ; si cela exige le core, signaler le besoin amont.

### L2 — Lire et importer une milestone préparée

**Dépendances :** L0 lecture et interface du receveur L1. **Dépôt :** intégration.

**Inclus :**

- Reconnaître le ticket de campagne et le Todo humain autorisé dans le périmètre
  configuré ; retenir la demande avant acquittement et ignorer ses doublons.
- Lire milestone, membres, descendants, critères, dépendances et références avec
  pagination et bornes. Conserver l’historique sans relancer les travaux terminés ;
  refuser ceux déjà engagés ou les dépendances externes sans preuve.
- Définir l’empreinte du périmètre matériel. Les commentaires/statuts du plugin et
  leurs timestamps n’entraînent pas une nouvelle identité ou un changement de portée.
- Importer sans wakes directs, relire la famille native puis présenter la source
  complète à L1. Aucune réécriture de parenté dans Linear ni admission anticipée.
- Conserver le contrat Todo historique et ses journaux ; distinguer les nouvelles
  campagnes sans réinterpréter les anciennes preuves ni les réenrôler.

**Surfaces candidates :** `src/webhook-event.ts`, `src/intake-*`,
`src/source-client.ts`, `src/source-family.ts`, `src/source-payload.ts`,
`src/source-graph.ts`, `src/import-*`, `src/council-handoff-*`, configuration,
tests `test/source-*`, `test/import-*`, `test/postgres/` et worker RPC.

**Fin vérifiable :** une fixture milestone avec deux feuilles et un critère commun
donne un import complet et une demande de campagne unique. Pagination incomplète,
mutation pendant lecture, cycle, acteur incorrect et doublon ne libèrent aucun
travail. Une coupure d’import reprend les mêmes objets. Le commentaire de suivi
simulé ne change pas l’empreinte du périmètre. Les tests Todo historiques passent.

**Couverture :** M01, M02, M06, M07, M10 ; A01 partiel, A02, A03, A04, A08.
**Hors lot :** écritures retour Linear, création de prérequis, absorption et
exécution réelle. Le lot se termine sur un import/admission préparé, pas sur une
campagne livrée. Un outil réel non confirmé reste un prérequis ouvert explicite.

### L3 — Publier et revalider sans modifier les descriptions

**Dépendances :** L0 publication, L1 et L2. **Dépôt :** intégration.

**Inclus :**

- Implémenter les opérations commentaires et statuts derrière les accès limités
  vérifiés ; utiliser la même connexion gérée et des références natives de secrets.
- Recevoir l’intention Council authentifiée, persister son identité et ses bornes,
  exécuter puis relire chaque effet. Répondre avec le résultat confirmé, refusé
  ou encore inconnu ; ne pas fabriquer un accusé à partir du seul HTTP 200.
- Retrouver un commentaire campagne/étape après réponse perdue. Sans preuve
  concluante, rester en attente plutôt que renvoyer sous une nouvelle clé.
- Répondre aux revalidations en cours de campagne, avant départ/fusion/clôture ;
  signaler source changée, indisponibilité et état humain incompatible. Exclure
  ses propres mises à jour des commandes et éviter le bruit de publication.
- Publier plan, fin de livraison, blocage/décision et bilan avec le même mécanisme.
  Les descriptions, relations, responsables et objectifs sont inchangés.

**Surfaces candidates :** gateway, `src/council-handoff-*`, journaux de publication
privés à l’intégration, worker/manifest/configuration et tests des transports
synthétiques, RPC et PostgreSQL. Les nouveaux modules sont nommés au lot, sans
fabriquer une infrastructure générique d’inbox/outbox.

**Fin vérifiable :** une intention rejouée ne produit qu’un commentaire identifié ;
un timeout reste réconciliable, un même ID avec un contenu différent est refusé,
une écriture hors champ n’est pas envoyée. Révocation d’écriture conserve la lecture.
Council ne reçoit pas de confirmation avant readback ; panne et divergence de
source retiennent le départ. Un redémarrage des deux côtés récupère la notification
perdue sous les identités initiales.

**Couverture :** M01, M05, M06, M07, M10 ; A01 partiel, A03, A04, A06, A08.
**Hors lot :** commandes pause/reprise depuis Linear, édition partagée et API de
création de ticket. Les fixtures prouvent le code ; la qualification d’écriture
réelle reste distincte. Une absence d’idempotence ne justifie aucun retry aveugle.

### L4 — Enchaîner les livraisons natives une par une

**Dépendances :** L1–L3 compatibles. **Dépôt :** Council.

**Inclus :**

- Brancher le plan ordonné sur le chemin natif d’une livraison complète. Conserver
  une référence distincte par feuille : tâche/mission, candidat, PR, revue et preuve
  intégrée. Le choix de représentation réutilise les objets existants et ne crée
  pas un deuxième budget ni une seconde autorité d’exécution.
- Publier et relire le plan avant le premier départ. Ne commencer la seconde
  livraison qu’après revue indépendante, contrôles, fusion, vérification intégrée
  et publication confirmée de la première.
- Revalider la base et le candidat exact avant fusion ; une base avancée impose
  adaptation/revue appropriée. Un échec après fusion suspend et demande une
  décision humaine, sans engager automatiquement correction ou revert.
- Respecter les contrôles L1 à chaque frontière d’effet, y compris après reprise.
  Le parent garde ses obligations propres et ne reçoit aucune PR redondante.

**Surfaces candidates :** `src/project-task-intake.ts`, `src/hierarchy-*`,
`src/continuity-*`, `src/integration-*`, `src/delivery-manifest.ts`, tests
hiérarchie/intégration et `tests/functional/`. Ne pas remplacer globalement la
hiérarchie existante à candidat commun ; ajouter le parcours campagne borné.

**Fin vérifiable :** deux feuilles entraînent deux PR distinctes dans le test
intégré, sans départ de la seconde avant toutes les preuves de la première.
Pause, publication perdue, base avancée, échec de revue ou échec après fusion
retiennent le bon effet. Un redémarrage ne recrée ni mission, ni PR, ni réservation.
Le parent n’est pas clôturé par la seule dernière fusion.

**Couverture :** M03, M04, M06, M07, M08 ; A01 partiel, A03, A05, A06.
**Hors lot :** concurrence sur un dépôt, transfert, prérequis automatiques et
revue globale. Si l’existant ne permet pas une unité de livraison isolée sans
refonte importante, arrêter au diagnostic et proposer un sous-lot précis.

### L5 — Vérifier la couverture globale et fermer la campagne

**Dépendances :** L4, avec L3 comme publisher. **Dépôt :** Council.

**Inclus :**

- Consolider les preuves existantes dans le bilan critère/source → livraison ou
  obligation transverse → vérification/environnement → résultat/preuve → reste.
- Faire vérifier ce bilan par un reviewer indépendant des auteurs ; réutiliser
  les revues de livraison, sans comité imposé ni deuxième audit de toutes les PR.
  La consolidation automatique existante ne remplace pas ce verdict global.
- Rattacher le verdict à la couverture et au résultat courants. Refuser un critère
  manquant, un Done manuel, une preuve périmée ou une publication inconnue.
- Publier bilan et statuts terminaux via L3, puis confirmer la clôture seulement
  après readback. Une panne de publication ne relance pas les agents de travail.
- Vérifier pause/annulation jusqu’à la publication terminale ; ne pas fermer
  automatiquement les PR. Libérer le dépôt après arrêt et réconciliation selon
  le TAD, en laissant les publications incertaines visibles.
- Rejouer le parcours complet avec les deux packages installés dans un host isolé,
  Linear et fournisseur simulés. Réutiliser le harness natif disponible et conserver
  les références de builds exacts des deux plugins.

**Surfaces candidates :** `src/completion-*`, `src/linear-continuity-*`, tâches
de revue natives, tests de complétion et harness sous `tests/functional/` /
`scripts/qualification/`. Les preuves restent dans le dépôt propriétaire du test.

**Fin vérifiable :** le scénario nominal simulé inclut le verdict indépendant et
la publication terminale ; les critères propres des parents et de la milestone
sont contrôlés. A07 refuse la clôture trompeuse. Pause/annulation concurrente à la
clôture donne un seul résultat terminal cohérent. La paire de packages fonctionne
sur le host isolé, avec interruptions et readbacks ciblés, sans prétendre prouver
les écritures Linear ou l’exécution d’un fournisseur réel.

**Couverture :** M01, M05, M07, M08, M09 ; A01 isolé complet, A03, A05, A07.
**Hors lot :** nouvelle console, activation opérationnelle, campagne fournisseur.
Un défaut d’intake découvert ici retourne au propriétaire L2/L3 dans une correction
bornée ; le lot Council ne modifie pas son dépôt voisin en passant.

### L6 — Qualifier un pilote réel utilisable

**Dépendances :** L1–L5 démontrés, builds compatibles et tous les prérequis réels
de L0 résolus. **Surfaces :** instance, projet Linear et dépôt de test explicitement
désignés ; preuves de recette référencées depuis l’intégration.

**Avant les effets :** identifier société/projets, milestone et acteurs autorisés,
profils lecture/publication, références de secrets, dépôt/branche cible, paquets,
mandat, budget fournisseur et périmètre de création/fusion des PR de test. Aucune
valeur de secret dans le rapport. La recette peut se tenir en une campagne bornée ;
ces identités n’imposent pas un nouveau circuit documentaire à chaque étape.

- Démontrer A01 : engagement Todo, source complète, plan lisible, deux livraisons
  et leurs PR réelles, revues, fusions, vérifications intégrées, critère transversal,
  reviewer global puis bilan/statuts Linear relus.
- Vérifier les lectures réelles séparément des écritures et les effets natifs
  séparément des appels fournisseur. Faire reprendre le contexte sans le chat.
- Réutiliser les preuves ciblées A02–A08 de L1–L5 ; ne pas rejouer chaque combinaison
  avec un fournisseur coûteux. Ajouter seulement les vérifications réelles qui
  couvrent une garantie externe non établie, notamment publication et droits.
- Montrer les commandes Paperclip et l’action attendue pour les cas reportés.
  Livrer un mode d’emploi court : préparer, engager, suivre, arrêter et reprendre.

**Fin vérifiable :** A01 réel passe et chaque A02–A08 possède sa preuve à la couche
appropriée ; aucun effet inconnu pertinent ne subsiste. Le rapport cite commits,
versions installées, objets de test et limites. Une recette partielle reste
partielle, même avec CI verte. L’autorisation du pilote n’active pas tous les
projets ni les campagnes anciennes ; l’usage opérationnel reste borné à la cible
effectivement autorisée. Si une capacité manque, arrêter la partie dépendante et
ouvrir une correction précise, sans élargir la V1.

## 4. Couverture et validations

| Exigence du PRD | Lots responsables | Preuve de sortie |
| --- | --- | --- |
| M01 — Contexte autonome | L2, L3, L5, L6 | A01 : plan et bilan accessibles depuis Linear, reprise sans chat. |
| M02 — Engagement exact | L1, L2, L6 | A02 et A08 : refus, doublon, occupation et activation bornée. |
| M03 — Autorité et exclusion | L1, L4, L6 | A01/A02 : mandat, budget et propriétaire unique du dépôt. |
| M04 — Livraisons sérielles | L4, L6 | A01/A06 : PR distinctes, revue, fusion et preuve intégrée. |
| M05 — Publication bornée | L3, L5, L6 | A01/A03/A04/A08 : champs préservés, readback et révocation. |
| M06 — Exceptions explicites | L1, L2, L3, L4 | A04/A06 : source changée et incident retiennent la suite. |
| M07 — Reprise sans double effet | L1–L5 | A03/A05/A06 : mêmes identités après timeout et restart. |
| M08 — Arrêt et reprise | L1, L4, L5, L6 | A05 : point sûr, reprise d’étape et annulation sans succès. |
| M09 — Clôture complète | L5, L6 | A07 et A01 : obligations globales, verdict et publication. |
| M10 — Activation et droits | L1, L2, L3, L6 | A02/A08 : défaut désactivé, historique préservé, droits limités. |

Dans l’intégration, utiliser `npm run check` ; les modifications SQL/reprise
requièrent aussi `npm run test:postgres` sur sa base de test isolée. Les changements
JS/TS passent l’audit statique du dépôt sur la base exacte et les contrôles CI.
Dans Council, utiliser les tests ciblés puis `pnpm typecheck`, `pnpm test`,
`pnpm build` et l’audit statique selon sa procédure courante. `pnpm test:functional`
et les harness natifs s’exécutent uniquement sur l’environnement isolé prévu.
Les commandes et effets des scripts sont relus à la révision du lot avant lancement.

La preuve minimale d’un lot contient son périmètre, le commit testé, les exigences
couvertes, les commandes et résultats, les limites et le prochain prérequis. Une
revue ciblée du diff suffit pour préparer sa PR ; les verdicts indépendants du
produit restent une obligation distincte. Aucun rapport ne déclare un lot aval
terminé parce que sa dépendance amont passe.

## 5. Compatibilité des changements et limites

La première règle est de conserver le comportement historique lorsque la campagne
V1 est désactivée. Les anciens IDs, journaux, preuves et configurations ne sont
pas adoptés automatiquement. Le producteur ne doit pas envoyer un nouveau contrat
à un consommateur incompatible ; conserver le chemin existant ou bloquer la
nouvelle capacité. Ne pas affaiblir le receveur pour rendre une fixture verte.

Classification de la future évolution de contrat, à préciser en L0 avant les
écritures de schéma/runtime :

```yaml
migration_id: linear-campaign-v1
classification: cross-plugin
owner: ty000.linear-intake — contrat source/publication, consommation validée par Council
surfaces:
  - linear-intake/source-et-readiness
  - linear-intake/revalidation-et-publication
  - paperclip-council/admission-et-continuite
  - paperclip-council/livraisons-et-completion
slicing_verdict: split-required
ordered_slices: [L1, L2, L3, L4, L5]
```

Chaque lot de schéma/contrat doit valider cette classification sur ses surfaces
exactes et passer le contrôle de migration avant écriture. Les migrations SQL
restent dans le namespace du plugin propriétaire et sont testées sur données
existantes. Si ce contrôle est indisponible, le lot reste bloqué avant mutation
de schéma ; une revue de texte ne le remplace pas. Le présent découpage n’exécute
aucune migration et n’exige aucun changement de schéma pour sa propre rédaction.

**Exclusions communes :** core/SDK Paperclip, nouvelle infrastructure générique,
automatisation des changements de périmètre, absorption, création de prérequis,
campagnes concurrentes sur un dépôt, commandes complètes depuis Linear, édition
de descriptions, fermeture automatique des PR annulées, correction/revert autonome
après fusion, Slack, déploiement et release. Réutiliser du code déjà présent ne
donne pas le droit d’activer ces comportements reportés.

**Premier lot recommandé : L0**, directement dans un run borné, sans refaire le
grill ni produire un backlog/sprint plan supplémentaire. Sa sortie détermine les
modifications indispensables de L1. Les autres lots restent planifiés ; les
écritures dans chaque dépôt et les effets du pilote devront être autorisés dans
le périmètre correspondant, sans élargissement implicite depuis ce document.
