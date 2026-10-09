# TAD — Première version utilisable Linear / Paperclip / Council

Version proposée : 0.2 · 9 octobre 2026 · Europe/Paris.

**Statut : draft révisé, dérivé du [PRD v0.3](PRD.md).** Il remplace le draft
v0.1 fourni dans le chat. Il décrit une V1 à réaliser et qualifier ; aucune
installation, activation ou exécution réelle n’est revendiquée par ce document.
Les comportements reportés sont ceux du PRD, pas des prérequis techniques cachés.

## 1. Choix d’architecture

Le parcours est : **Todo du ticket de campagne → lecture et admission → livraisons
sérielles → bilan indépendant → publication et clôture.** Une campagne possède un
périmètre fixé et occupe son dépôt jusqu’à arrêt réconcilié ou terminaison.

| Composant | Responsabilité V1 | Réutilisation à privilégier |
| --- | --- | --- |
| Intégration Linear | Retenir la demande, lire la milestone complète, importer, publier commentaires/statuts et vérifier les effets | Webhook signé, jobs, correspondances, journaux d’effets et gateway géré existants. |
| Council | Posséder campagne, mandat, occupation du dépôt, livraison courante, arrêts, revue et bilan | Admission, comptabilité, agents et contrôles existants ; complément seulement pour une lacune démontrée. |
| Paperclip | Fournir les tâches, agents, affectations, routines/jobs, stockage et surfaces de décision | Contrats natifs supportés, sans modification implicite du core ou SDK. |
| Linear | Objectifs et critères humains ; engagement initial ; résultats et preuves publiés | Tickets, milestone, commentaires, statuts et liens existants. |

L’intégration ne réveille pas les agents d’implémentation. Un agent Codex externe
peut préparer un document ; il ne porte ni état durable, ni exécution parallèle,
ni verdict concurrent à Paperclip/Council.

Aucun nouveau service, broker, ordonnanceur, interface utilisateur ou protocole
générique de synchronisation n’est requis. Les mécanismes de reprise existants
sont étendus seulement pour les opérations V1. La simplicité du parcours ne
permet pas de supprimer la persistance avant effet ni l’exclusion des doublons.

## 2. Point de départ et capacités à confirmer

Base documentaire : `5b5255c8bff158eea7c090e752d8698cd523f57f` ; paquet intake
`0.4.0`. Le [contrat actuel](TODO-INTAKE-CONTRACT.md) couvre Todo et un sous-arbre,
et le [handoff](COUNCIL-HANDOFF-V1.md) couvre la revalidation avant admission.
Le [receveur qualifié](qualification/COUNCIL-RECEIVER.md) a été démontré avec
Council `0.7.18` dans une instance isolée, jusqu’à N1, avec Linear et modèle
simulés. Cela ne prouve ni la campagne milestone, ni le writeback, ni les fusions.

Le draft précédent référençait Paperclip `61b3fd5` et Council `1e7f374` (`0.7.22`).
Ces observations sont des pistes de réutilisation, pas une qualification nouvelle.
Avant chaque lot, vérifier le contrat réellement utilisé et la révision du candidat.
En particulier, une hiérarchie à candidat commun ne prouve pas une PR par feuille.

Quatre vérifications suffisent pour choisir les mécanismes du premier parcours :

1. Lire milestone, tickets/descendants, critères, dépendances, références et auteur
   du Todo, avec pagination complète et limites explicites.
2. Ajouter et retrouver un commentaire identifié ; lire et changer uniquement
   les statuts autorisés. Pas de création de ticket, réécriture de description
   ou mise à jour de relations dans les permissions V1.
3. Réutiliser l’admission et la conduite native pour une PR par livraison, avec
   arrêt avant nouveau départ/fusion, reprise et revue indépendante.
4. Réserver durablement un dépôt pour une campagne et empêcher toute admission
   concurrente vers ce dépôt, y compris le parcours Todo ponctuel existant.

La lecture de schémas peut établir ce qu’un outil déclare. Les garanties d’écriture
et de reprise demandent une qualification d’écriture distincte. On ne cherche pas
un catalogue exhaustif ni une capacité de mise à jour atomique des descriptions,
puisque la V1 ne les modifie pas. Une capacité obligatoire absente reste une lacune
précise à traiter, sans construction automatique d’un framework de remplacement.

## 3. Configuration et données minimales

Réutiliser la configuration désactivée existante : société/projet Paperclip,
organisation/équipe/projet Linear, dépôt canonique, acteurs, états, connexion gérée
et références natives de secrets. Ajouter uniquement la reconnaissance du ticket
de campagne et les droits nécessaires aux commentaires/statuts. Les profils lecture
et publication partagent la connexion ; révoquer l’écriture conserve la lecture.

Un ticket de campagne contient la référence explicite de milestone et les versions
PRD/TAD validées. Son type est reconnu par un modèle ou marqueur configuré ; ce
marqueur ne remplace ni l’acteur autorisé, ni la transition Todo, ni le mandat.
Le ticket est hors de la milestone pour ne pas fausser sa progression.

Trois groupes d’informations sont nécessaires, sans imposer trois nouvelles tables :

| Groupe | Propriétaire | Minimum à conserver |
| --- | --- | --- |
| Correspondance et source engagée | Intégration | IDs source/natifs, demande initiale, contenu et empreinte du périmètre, preuve de complétude. Réutiliser les journaux actuels. |
| Campagne | Council | Identité stable, dépôt réservé, mandat et versions, plan ordonné, livraison courante, état, motif d’attente, références des preuves et verdict global. Réutiliser budget et historique natifs. |
| Effet à publier | Intégration | Identité stable, campagne/étape, objet/champs autorisés, contenu attendu, état d’envoi et résultat relu. Étendre le journal d’effets existant. |

Les preuves vivent dans les artefacts et systèmes qui les produisent ; la campagne
les référence. Le plan et le bilan sont des sorties de la campagne projetées dans
Linear, pas de nouveaux registres distribués indépendants.

Les documents Paperclip sont modifiables : le SDK observé expose `upsert` et
`delete`, sans `baseRevisionId` pour ces documents. Ne pas leur attribuer une
immutabilité native. Une discipline applicative de versionnement doit être nommée
comme telle ; les décisions restent liées au contenu/résultat exact vérifié.

## 4. Engagement, source fixe et exclusion par dépôt

1. Le webhook vérifie signature, origine, état et auteur, puis persiste la demande
   avant acquittement. Le job existant effectue les lectures hors du webhook.
2. La lecture rassemble objectifs de milestone, membres, descendants, critères,
   dépendances et références. Vérifier les limites et l’inventaire après lecture ;
   une source changeante ou tronquée reste non prête. Ne pas promettre un snapshot
   atomique global de Linear.
3. L’import conserve les identités et reste inéligible jusqu’au readback complet.
   Council vérifie le mandat et réserve le dépôt avant admission. Une demande
   répétée retrouve cette campagne ; une autre demande trouve le dépôt occupé.
4. Le lead établit le plan dans le périmètre déjà préparé. L’intégration publie
   le commentaire de démarrage avec plan, versions et liens, puis le relit avant
   le premier travail. Aucun prétraitement automatique en Backlog n’est requis.

L’occupation est un enregistrement durable avec acquisition exclusive, non un
verrou en mémoire. Un redémarrage conserve son propriétaire ; il ne libère pas
le dépôt sur la seule expiration d’un délai. Vérifier la primitive native ; si
elle manque, ajouter seulement cette exclusion dans le stockage propriétaire
Council. Pas de file de priorité, de transfert de campagne ni de workers de fusion
concurrents à coordonner en V1.

Tous les chemins d’admission Council qui peuvent viser le dépôt doivent respecter
cette exclusion. Le pilote refuse un dépôt déjà occupé par un travail non raccordé
à ce contrôle. Les fusions externes restent possibles : une base avancée invalide
la préparation d’intégration et impose revalidation avant fusion.

L’empreinte de périmètre couvre les membres et leur hiérarchie, objectifs/critères,
dépendances et références PRD/TAD. Les commentaires de suivi, timestamps de ces
publications et statuts du plugin n’y entrent pas. Comparer le contenu matériel,
pas seulement `updatedAt`, pour éviter de suspendre sur ses propres écritures.
Relire avant départ d’une livraison, avant fusion et avant clôture ; les signaux
intermédiaires peuvent accélérer la détection. Il n’y a pas de garantie de détection
instantanée d’une modification survenue après la dernière lecture.

Une modification observée suspend toute la campagne au prochain point sûr. La
V1 n’adopte pas un nouveau périmètre dans la même campagne. L’opérateur restaure
le périmètre engagé ou annule puis prépare une nouvelle demande conforme aux
conditions d’admission. Aucun travail déjà géré n’est absorbé automatiquement.

## 5. Échanges entre les plugins

Réutiliser le bus natif authentifié et les jobs de reprise du handoff actuel.
Les tables restent privées à chaque plugin. Limiter les nouveaux échanges à :

| Échange | Contenu utile | Confirmation |
| --- | --- | --- |
| Source prête / revalidation | Demande et source exactes, périmètre, objets natifs, observation actuelle ou blocage | Council rattache le résultat à son admission/campagne existante. |
| Publication demandée / résultat | Campagne et étape, objet/champs permis, contenu et référence de résultat Council | Intégration retourne effet relu, refus ou résultat encore inconnu. |

Pause/reprise, propriété des livraisons, budget et verdict restent internes à
Council. Leur visibilité Linear passe par le même mécanisme de publication.
Pas de famille séparée de contrats pour transfert, couverture, clôture ou chaque
étape du workflow. Faire évoluer les schémas nécessaires avec compatibilité
explicite, sans imposer dès maintenant `campaign-sync.v2` ni huit interfaces.

Chaque opération conserve identité, société, source/campagne et version utile à
son contrôle. Vérifier l’origine dans l’enveloppe native, pas dans un simple champ
fourni par l’émetteur. Persister la demande et son résultat ; une notification
perdue est récupérée par le job à partir de l’opération originale. Les messages
répétés renvoient l’état connu ; un même ID avec un contenu différent est refusé.
Un événement tardif ne doit pas faire régresser une campagne.

Ces règles sont nécessaires pour les deux échanges concrets, pas une demande de
construire un transport générique, un ordre global de messages ou de lire les
tables de l’autre plugin.

## 6. Publication Linear sans édition partagée

L’intégration ajoute un commentaire au démarrage, à la fin d’une livraison,
lors d’un blocage/changement de décision significatif et au bilan terminal.
Chaque commentaire porte une référence logique campagne/étape ; Council conserve
son ID et son lien après readback. Le bilan final est autonome et cite les preuves
ainsi que les commentaires utiles. Aucun commentaire par heartbeat ou microtâche.

Les commentaires précédents ne sont ni réécrits ni déclarés immuables. Si un
résultat publié doit être rectifié, publier une nouvelle entrée identifiée qui
référence la précédente. Une disparition ou altération observée d’une preuve
nécessaire doit être résolue avant de l’utiliser pour une clôture.

Les seules autres écritures sont les statuts convenus des tickets gérés. Les
objectifs, descriptions, critères, responsables, relations et documents humains
restent en lecture seule. Les PR et preuves sont liées dans les commentaires ;
aucune API d’attachement particulière n’est un prérequis.

Pour chaque écriture : contrôler portée et mandat, persister intention et ID,
envoyer, relire les champs/commentaire exacts et conserver le résultat. Une
réponse perdue mène à une recherche corrélée sous la même identité. Rechercher
avant réessai ; la seule absence dans une réponse partielle ne prouve pas l’échec.
Sans idempotence qualifiée ou preuve concluante, retenir l’effet et demander une
intervention au lieu de renvoyer aveuglément un commentaire ou une création.

Les changements de statut du plugin ne redéclenchent pas Todo. La V1 utilise
Paperclip pour les commandes après engagement ; un statut humain inattendu est
signalé et suspend les effets dépendants dès observation, sans guerre de mises
à jour. Un read-before-write/readback n’est pas une garantie atomique : limiter
les écritures au champ de statut, vérifier le résultat et exposer les conflits.
Un Done humain ne constitue jamais une preuve de livraison ou de clôture interne.

Si la publication d’une étape requise échoue, Paperclip conserve le résultat
métier mais retient la progression dépendante. La clôture reste en attente de
publication ; on ne refait pas la revue ou le travail pour cette seule raison.

## 7. Exécution, arrêt et reprise

Council réutilise les tâches/agents et politiques d’exécution natives pour les
livraisons. La V1 ajoute uniquement l’ordre et les contrôles de campagne manquants.
Chaque feuille de code possède sa PR ; la suivante commence après revue,
contrôles, fusion du candidat exact et vérification intégrée. Une investigation
sans code produit une preuve adaptée, pas une PR fictive.

Les états de campagne sont simples ; les étapes courantes et motifs d’attente sont
conservés comme données, pas comme une seconde machine d’orchestration complète :

| État | Signification / sortie |
| --- | --- |
| préparation | Demande retenue, lecture/import/admission/plan en cours. Aucun départ avant leurs confirmations. |
| active | Exécution sérielle puis revue globale. |
| suspendue | Pause, incident, source changée ou prérequis manquant. Reprise explicite après disparition des motifs et revalidation. |
| terminée | Critères, verdict et publications terminales confirmés. |
| annulée | Travail restant arrêté, effets envoyés réconciliés ; aucun succès global. |

Une demande d’arrêt est persistée séparément avant son achèvement. Pause et
annulation sont possibles depuis tout état non terminal, y compris préparation,
revue globale et attente de publication. Dès observation, aucun nouveau travail
ni nouvelle fusion ; l’opération déjà envoyée atteint un point sûr et son résultat
est réconcilié. Si arrêt et clôture se présentent ensemble, une transition
révisionnée Council décide de l’état final sans deux résultats terminaux.

La reprise réutilise campagne, mandat, budget consommé, preuves et intentions.
Elle revient à l’étape interrompue : une pause pendant la préparation ne permet
pas de sauter l’import, l’admission ou la publication du plan. Une décision humaine
et ses conséquences sont publiées et relues avant les effets qui en dépendent.
Une suspension ne libère pas le dépôt. L’annulation ne retire pas du code intégré
et ne ferme pas automatiquement les PR ; son bilan les liste pour traitement
humain. Après arrêt et réconciliation, Council libère l’occupation du dépôt ;
une publication terminale encore incertaine reste suivie et visible séparément.

Une panne Linear retient nouveaux départs, fusions et clôtures. Un échec après
fusion retient la suite et demande un rétablissement humain. Une reprise exige
une base saine, le candidat actuel vérifié, le périmètre engagé et les effets
antérieurs déterminés. Un revert humain ne satisfait pas à lui seul les critères
de la livraison. Les corrections ordinaires avant fusion restent autonomes dans
les limites du mandat.

## 8. Bilan et clôture

Le lead prépare un tableau simple sur le ticket de campagne :

| Critère et source/version | Livraison ou obligation transverse | Vérification / environnement | Résultat et preuve exacte | Reste à traiter |
| --- | --- | --- | --- | --- |

Le reviewer indépendant vérifie ce tableau, les obligations propres des parents
et la cohérence du résultat intégré. Il réutilise les revues de livraison et
preuves encore valides ; pas de nouvelle batterie générale ni de comité imposé.

La clôture exige tous les critères engagés satisfaits, aucun blocage pertinent ni
effet inconnu, un verdict favorable lié au résultat courant et la publication
relue du bilan et des statuts terminaux. Une exception ne permet pas de supprimer
un critère silencieusement : en V1, changer le périmètre relève de l’arrêt et d’un
nouvel engagement. Synthétiques pour les règles quand suffisants ; preuve native
ou réelle pour les effets de cette couche effectivement revendiqués.

## 9. Qualification et réalisation progressive

| Travail | Propriétaire | Preuve proportionnée |
| --- | --- | --- |
| Vérifications de capacité ciblées | Intégration et Council, chacun dans son dépôt | Réponses aux quatre points du §2 à partir des sources ; catalogue réel seulement avec cible, société, profil et portée autorisés. Une lecture ne prouve pas une écriture. |
| Parcours vertical minimal | Intégration + Council, changements séparés par dépôt | Milestone préparée → source/import → admission exclusive → deux livraisons sérielles → commentaires → revue globale → clôture, d’abord avec transports de test. |
| Refus et reprises essentiels | Propriétaires des effets | Tests ciblés A02–A08 du PRD, notamment courses d’admission, pause avant/après dispatch, redémarrage et réponse perdue ; pas de nouvelle infrastructure générique. |
| Recette du pilote | Cibles de test explicitement autorisées | A01 réel avec lecture/écriture Linear, effets natifs Paperclip, agents, PR/fusions et vérification intégrée ; contrôle humain de la lisibilité. Les fixtures ne remplacent pas cette preuve. |

Le parcours vertical se réalise en changements bornés et testables. Il n’est pas
nécessaire d’achever toutes les extensions futures avant de démontrer sa valeur.
Les tests de refus/reprise indispensables restent requis avant usage réel.

Traçabilité des exigences :

| Exigence PRD | Réalisation TAD | Scénarios PRD |
| --- | --- | --- |
| M01 | §§3, 6, 8 : contexte et bilan accessibles | A01 |
| M02 | §§3–4 : commande, complétude et identité | A02, A08 |
| M03 | §§1, 4, 7 : Council et occupation du dépôt | A01, A02 |
| M04 | §7 : PR sérielles, revue et intégration | A01, A06 |
| M05 | §6 : commentaires et statuts bornés | A01, A03, A04, A08 |
| M06 | §§4, 7 : source fixe et arrêt explicite | A04, A06 |
| M07 | §§3, 5–7 : persistance et reprise | A03, A05, A06 |
| M08 | §7 : arrêts depuis tout état non terminal | A05 |
| M09 | §8 : couverture et confirmation finale | A01, A04, A07 |
| M10 | §§3, 10 : permissions et activation explicite | A02, A08 |

Conserver les distinctions source/build, tests synthétiques, instance native,
lecture réelle, écriture réelle et agents/Git réels dans les résultats de recette.
Elles décrivent ce qui a été vérifié ; ce ne sont pas neuf sous-projets à lancer
systématiquement pour chaque modification documentaire ou chaque livraison.

## 10. Compatibilité et limites

Conserver identité du plugin, namespaces, correspondances, journaux et preuves
historiques. Installer ne réengage pas d’ancien Todo. La fonctionnalité campagne
reste opt-in ; ne pas multiplier ses interrupteurs internes en six capacités
indépendantes. Le mode actif exige ses prérequis ; une révocation d’écriture est
un blocage diagnostiquable, pas un mode de réussite sans publication.

Une évolution de schéma doit être bornée aux données V1 et documenter les versions
compatibles. Une version qui ne comprend pas un effet en cours ne l’efface ni ne
le réessaie. Les contrats historiques gardent leur portée ; leur terme « immutable »
ne modifie pas les garanties effectives du SDK sur les documents.

Les points encore ouverts sont limités aux [questions V1](TAD-QUESTIONS.md).
Pas d’objectif garanti à la minute, de système de rétention avancé, de parallélisme
sur un dépôt, d’absorption, de replanification automatique ou de remédiation après
fusion dans cette version. Les bornes de volume et tentatives existantes restent
appliquées et doivent produire un blocage lisible si elles sont atteintes.

Ce TAD est une proposition documentaire. La révision n’a modifié ni code, ni
configuration, ni dépôt voisin ; elle n’a exécuté aucun gateway ni qualification
native. L’implémentation Council relève d’un lot explicitement borné à son dépôt.
