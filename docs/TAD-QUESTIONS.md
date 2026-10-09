# Questions pour le grill technique — Intégration Linear / Paperclip / Council

9 octobre 2026 · Source produit : [PRD v0.2](PRD.md).

**Ce fichier n'est pas un TAD.** Il contient uniquement les questions à résoudre
pour pouvoir en rédiger un. Les décisions produit acquises restent dans le PRD.
Les propositions précédentes de modules, de noms ou de mécanismes ne valent pas
choix technique. Le prochain grill pourra suivre cet ordre, une question à la
fois ; les faits disponibles dans le code ou le runtime seront inspectés plutôt
que redemandés à l'utilisateur.

Les décisions D15–D21 fixent désormais l'adaptation automatique des changements
autorisés, la correction expliquée des statuts, la pause au prochain point sûr,
le rattachement d'un ticket à sa milestone, la création de prérequis techniques,
le rétablissement après échec d'intégration et l'annulation du travail restant.
Les questions ci-dessous portent sur leur réalisation et leur qualification,
sans rouvrir ces arbitrages produit.

## T01 — Réutilisation native et responsabilité des campagnes

**Quelles capacités natives Paperclip couvrent la conduite des campagnes, et quels
compléments appartiennent réellement à Council ?**

- Quelles primitives existantes couvrent engagement, plan, affectation,
  dépendances, admission, revue, pause, reprise, budget et fermeture ?
- Qui possède l'état et l'autorité de chaque transition ; où se situe la
  frontière avec les lectures et écritures de l'intégration Linear ?
- Comment éviter un second ordonnanceur ou une seconde autorité de verdict ?
- Quel inventaire de code, APIs et preuves permet d'attribuer chaque capacité
  sans confondre disponibilité native et fonctionnement qualifié ?

## T02 — Engagement et périmètre versionné

**Comment représenter l'engagement explicite d'une milestone et le distinguer
d'une demande Todo portant sur un ticket ?**

- Quelle surface native porte l'acte, son auteur, le projet, le dépôt et les
  limites ; comment les membres et révisions initiales sont-ils identifiés ?
- Comment rattacher un ticket déjà engagé à la campagne de milestone comme
  livraison courante, avec conservation du travail, des identités, des preuves,
  de l'historique et du budget consommé, sans double exécution (D18) ?
- Comment traiter les autres activations recouvrantes, une milestone déjà
  partiellement réalisée et des tickets historiquement Todo ?
- Comment réconcilier ajout, retrait, changement de milestone, pause ou annulation
  sans élargir silencieusement l'autorité initiale ?
- Comment établir qu'un nouveau ticket technique sert strictement les critères
  déjà autorisés et respecte produit, TAD et limites, puis confirmer sa création,
  son rattachement et ses dépendances avant sa prise en charge (D19) ?

## T03 — Contexte autonome, plan et correspondances

**Quel contrat permet de reconstruire un contexte complet depuis Linear et de
relier chaque objet à son exécution Paperclip ?**

- Où vit le plan de référence unique et comment devient-il accessible depuis
  Linear avec le cadrage, le TAD et leurs versions applicables ?
- Quels identifiants et révisions relient projet, milestone, ticket, sous-ticket,
  campagne, mission, PR, preuve et décision humaine ?
- Comment vérifier descriptions complètes, pagination, documents liés,
  droits d'accès et absence d'une information décisive cachée dans un chat ?
- Quelles correspondances existantes peuvent être réutilisées ; comment sont
  conservés les résultats terminés, annulés et les imports historiques ?

## T04 — Contrat d'échange Council / intégration Linear

**Quel échange transporte les faits établis par Council et les changements lus
dans Linear, avec une autorité vérifiable et une reprise durable ?**

- Quels faits, demandes et confirmations sont nécessaires pour démarrage,
  changement de contexte, revue, correction, blocage, décision, fusion et clôture ?
- Quelles surfaces natives conviennent, et comment authentifier origine, société,
  projet, objet, révision, résultat et portée de chaque message ?
- Quelle partie conserve l'intention et la preuve de consommation ; comment
  récupérer une notification perdue sans considérer sa livraison comme un effet ?
- Comment faire évoluer le handoff actuel sans accès direct aux tables de l'autre
  plugin ni réinterprétation des preuves historiques ?

## T05 — Connexion Linear et autorité d'écriture

**Quels outils de la connexion gérée couvrent effectivement les lectures et
écritures requises, sous quelles permissions ?**

- Quels schémas observés couvrent milestones, tickets, relations, documents,
  commentaires, statuts, responsabilités et relectures ? Quelles capacités manquent ?
- Comment distinguer lecture, import et écriture dans la configuration et les
  droits ; comment rattacher chaque effet à son périmètre autorisé ?
- Quel accès de gateway et quelles références natives de secrets sont nécessaires,
  sans transférer les jetons OAuth ni employer une identité opérateur dans le plugin ?
- Comment traiter un refus, une demande d'approbation, une expiration ou un schéma
  de connecteur modifié sans changer silencieusement de chemin d'accès ?

## T06 — États, champs et preuves publiés dans Linear

**Comment projeter les faits d'exécution sur Linear sans confondre états métier,
attentes internes et preuves de complétion ?**

- Quels états disponibles de chaque équipe représentent en cours, revue,
  correction, attente et intégré ; que faire lorsqu'il n'existe pas d'équivalent ?
- Qui est autorisé à modifier chaque champ, et lesquels restent protégés contre
  une réécriture automatique ? Comment représenter les agents responsables ?
- Comment appliquer la correction automatique et expliquée des statuts de
  progression incohérents avec les preuves, tout en reconnaissant et respectant
  les commandes de pause et d'annulation (D16, D17, D21) ?
- Quelles informations appartiennent à la description, au plan, à un document,
  à une relation ou à un commentaire ; comment éviter le bruit et la duplication ?
- Quelle observation confirme une mise à jour, une PR liée, une feuille Done,
  les obligations propres d'un parent et la clôture d'une milestone ?

## T07 — Ordre, doublons et résultats incertains

**Comment garantir la convergence des échanges sans double effet ni retour à un
état obsolète ?**

- Quels moyens natifs permettent de persister une intention avant écriture,
  d'ordonner les opérations et de récupérer les travaux interrompus ?
- Quelles garanties d'idempotence et de concurrence offre réellement le
  connecteur ; quels contrôles doivent être apportés par l'intégration ?
- Comment distinguer un effet absent, confirmé ou encore inconnu après un timeout,
  une réponse perdue ou un redémarrage ?
- Comment reconnaître un webhook issu de nos propres écritures, sans ignorer un
  changement humain concurrent ni créer une boucle import/publication ?

## T08 — Changements en cours et invalidation ciblée

**Comment détecter les changements matériels et suspendre seulement les travaux
dont les hypothèses ou preuves ne sont plus valides ?**

- Comment vérifier l'habilitation de l'auteur et la compatibilité d'une
  modification avec produit, TAD et limites pour adapter puis poursuivre sans
  seconde confirmation (D15) ; qui établit cette classification et sa preuve ?
- Comment retenir les seuls travaux dépendants lorsqu'une autorité n'est pas
  établie ou qu'un dépassement nécessite un arbitrage ?
- Comment comparer source actuelle et version consommée, puis suivre l'impact sur
  les descendants, dépendants, plans, candidats et verdicts ?
- À quel point sûr arrêter les nouveaux effets d'un travail déjà en cours,
  notamment lorsqu'une fusion est revendiquée ou son résultat inconnu ?
- Comment réconcilier une modification humaine et une écriture automatique
  concurrentes sans écrasement silencieux ni révalidation générale inutile ?

## T09 — Campagnes parallèles et intégration sérielle

**Comment réaliser le parallélisme entre campagnes en conservant la séquence
de livraison et les dépendances vérifiées de chacune ?**

- Quels contrôles natifs couvrent isolation des workspaces, propriété des chemins,
  capacité, budgets et accès à une même branche cible ?
- Comment traiter plusieurs campagnes visant le même dépôt, ainsi que des
  dépendances entre campagnes de dépôts distincts ?
- Quelle preuve satisfait chaque dépendance ; comment éviter qu'un simple statut
  Done ou une relation de parenté libère un travail à tort ?
- Comment gérer base avancée, conflit d'intégration, candidat modifié et nouvelle
  revue avant de commencer la livraison suivante ?
- Comment représenter un échec après fusion, rattacher la PR corrective ou de
  retour arrière et vérifier ses conséquences, l'autorité et le budget avant
  contrôles, revue indépendante et nouvelle vérification intégrée (D20) ?
- Comment conserver le blocage de la livraison suivante tant que les obligations
  applicables restent insatisfaites, même si un retour arrière rétablit la base ?

## T10 — Indisponibilité, arrêt et reprise

**Quels contrôles empêchent nouveaux départs, fusions et clôtures lorsque la
source Linear ou sa synchronisation ne sont plus suffisamment vérifiables ?**

- Comment distinguer indisponibilité réseau, lecture partielle, refus d'accès,
  écriture en attente et effet inconnu ?
- Quels travaux locaux déjà admis peuvent finir ; comment conserver leurs
  résultats, limites et responsabilité sans réveil supplémentaire implicite ?
- Quelles observations rendent la reprise possible et comment s'assurer qu'un
  changement intervenu pendant la panne a été pris en compte ?
- Quelles limites de tentatives et d'attente réutiliser ; quelle action humaine
  est attendue lorsque la réconciliation demeure non concluante ?
- Quels points sûrs permettent à la seule opération en cours de préserver un
  état récupérable après pause, sans nouveau travail ni nouvelle fusion ; comment
  réconcilier un effet déjà envoyé et authentifier la reprise explicite après
  revalidation (D17) ?
- Comment appliquer l'annulation du travail restant, réconcilier les effets puis
  fermer les seules PR non fusionnées devenues sans objet, conserver leurs
  commits et préserver les livraisons déjà intégrées (D21) ?
- Comment représenter travail livré et annulé sans succès global ni reprise
  implicite, et distinguer une demande séparée de retrait du code intégré ?

## T11 — Arbitrages et visibilité dans les surfaces natives

**Comment rendre l'état du travail et de la synchronisation compréhensible dans
Paperclip et Linear, sans nouveau canal Slack dans ce périmètre ?**

- Quelle surface Paperclip présente question, responsable, options et contexte
  exact ; comment authentifier et rattacher la réponse à la bonne révision ?
- Comment confirmer sa consignation dans Linear avant la reprise dépendante ?
- Où voir les écritures en attente, l'effet inconnu, le travail encore possible
  et la prochaine action ; quelles alertes natives sont déjà disponibles ?
- Quels contrôles d'accès, de lisibilité et d'accessibilité appliquer aux surfaces
  retenues et aux liens vers les preuves ?

## T12 — Évolution du plugin et compatibilité

**Comment faire évoluer le même plugin sans perdre ses identités, ses preuves
ni ses configurations historiques ?**

- Faut-il conserver l'identifiant technique, le namespace et les noms d'événements
  existants ; quelles conséquences auraient les changements de nom envisagés ?
- Quels modules, contrats et données peuvent être conservés ou doivent évoluer,
  avec quelles migrations et compatibilités entre versions Council/intégration ?
- Comment maintenir séparées les activations de lecture, import, suivi et écriture,
  et revenir à un état maîtrisé sans effacer un effet externe déjà réalisé ?
- Comment préserver l'état des anciennes missions tout en introduisant les
  capacités milestone, ticket sans enfant et dépendances entre campagnes ?

## T13 — Qualification et sortie du futur TAD

**Quelles preuves rendront l'architecture suffisamment définie et vérifiable
pour autoriser ensuite des lots d'implémentation bornés ?**

- Quelle matrice reliera décisions D01–D21, exigences R01–R17, composants
  propriétaires, interfaces, scénarios V01–V18 et preuves attendues ?
- Quels contrôles sont déterministes, lesquels nécessitent un host Paperclip
  isolé, une vraie connexion Linear, de vrais agents ou une fusion Git observée ?
- Quel scénario représentatif vérifiera reprise sans contexte, campagnes
  dépendantes, changement de source, panne, doublon et clôture sans faux succès ?
- Quelles preuves couvrent les variantes autorisées et refusées de D15–D21,
  notamment budget conservé au rattachement, périmètre du prérequis créé,
  correction de statut distincte d'un arrêt, fusion déjà envoyée et obligations
  restant ouvertes après un retour arrière ou une annulation ?
- Quelles conditions sépareront code, qualification, installation et activation,
  avec migration vérifiée avant toute évolution de gate opérationnelle ?
- Quel résultat de clôture sera exposé à un futur cycle de release sans inclure
  ici preview, QA de release ou production ?
