# Raccordement V1 — résultat de L0

9 octobre 2026. Décisions d’implémentation du [plan L0–L6](V1-IMPLEMENTATION-PLAN.md),
sans extension du [PRD](PRD.md). Cette note clôt l’inspection statique L0 ; elle
ne qualifie pas un gateway, des écritures Linear ou un déploiement.

## Sources et capacités

Intégration : `18735bacc17bed9c11013410ee32cbddc31bb42c` (`0.4.0`).
Council : `91b4e583abf6e1b47796a4501f07e9953175c670` (`0.7.26`).
Host Paperclip consulté : `61b3fd57a695614dc4a37e2303f426a34a9795cf`.
Les sources core/SDK et les checkouts existants restent en lecture seule.

| Opération | Preuve disponible | Décision / manque |
| --- | --- | --- |
| Engagement humain Todo | `src/webhook-event.ts`, `src/intake-authority.ts` et contrat Todo | Réutiliser signature, acteur, portée, rétention et déduplication. L2 distingue le ticket de campagne. |
| Identité/texte de milestone | Le [catalogue historique](qualification/native-input-schemas.json) déclare `get-project.includeMilestones` | Lire le projet exact avec cette option. La forme, la complétude et le contenu réels des milestones restent à qualifier. Aucun nom d’outil supplémentaire supposé. |
| Inventaire des membres | Le même catalogue déclare `projectMilestone` dans `get-issue` et `list-issues`, mais aucun filtre milestone dans `list-issues` | L2 peut parcourir les métadonnées du seul projet autorisé, paginer complètement puis sélectionner l’ID exact. L’activation doit autoriser cette portée ; dépasser les bornes bloque. Lire les descendants sans les masquer par un filtre projet. |
| Contenus/dépendances | `src/source-family.ts`, `src/source-payload.ts`, preuve historique du lecteur | Réutiliser descriptions complètes, relations et relectures. Étendre au graphe milestone ; la preuve Todo historique ne prouve pas cette extension. |
| Publication commentaire/statut | Aucun schéma d’écriture dans les preuves de ce dépôt | L3 implémente un adaptateur à outils explicitement épinglés et des tests simulés. Le catalogue réel doit confirmer arguments, réponses, pagination des commentaires et droits avant activation. Aucun nom ou schéma réel inventé. |
| Échanges après admission | Council `src/linear-continuity-{contract,transport,documents}.ts` | Réutiliser challenge, documents, intentions et accusés. Ajouter une politique V1 explicite ; ne pas annoncer les trois capacités historiques si elles ne sont pas fournies. |
| Une PR par livraison | Council `src/delivery-leaves.ts`, `src/project-task-intake.ts` | Le parcours existe pour `originKind === "manual"` avec résultat `integrated-verified`. L4 l’étend aux feuilles importées ; ne pas remplacer la hiérarchie historique à candidat commun. |
| Occupation du dépôt | Les gardes actuelles valident mandat, source et prédécesseur ; aucun registre exclusif de dépôt observé. Le SDK expose `db.query/execute`, pas une réservation de dépôt | L1 ajoute une acquisition SQL atomique privée à Council, commune à ses admissions. Pas de bail expirant ni d’ordonnanceur supplémentaire. |
| Commandes | Council `src/worker.ts`, `src/linear-continuity-runtime.ts` | Utiliser l’API native `mission-command` et son contrôle du propriétaire pour pause/reprise/annulation. Pas de commande depuis Linear après Todo. |
| Annulation | Council `src/linear-continuity-cancellation.ts` peut lancer `cancel-pr` | La politique campagne V1 conserve les PR pour traitement humain. Les anciennes missions gardent leur politique. |
| Clôture | Council `src/completion-runtime.ts` consolide et contrôle des preuves | L5 ajoute le verdict global indépendant et attend les accusés Linear avant succès. Le contrôle existant des obligations parent reste réutilisé. |

Le scan de projet porte sur les métadonnées nécessaires à l’appartenance ; il
n’autorise ni import ni lecture exhaustive du contenu des tickets hors sélection.
Les bornes existantes restent explicites, y compris la limite du receveur Council.
La vérification réelle des lectures et celle des écritures sont deux preuves
distinctes. Les outils du connecteur Codex ne servent pas de preuve du gateway.

## Ticket de campagne et représentation native

Reconnaissance par un unique bloc JSON balisé `paperclip-campaign`, dans la
description rédigée par l’humain. Pas de heuristique sur le titre ou la date cible.
Le bloc contient uniquement :

```json
{
  "schema": "linear-milestone-campaign.v1",
  "milestoneId": "11111111-1111-4111-8111-111111111111",
  "prd": {"url": "https://example.invalid/prd", "version": "0.3", "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},
  "tad": {"url": "https://example.invalid/tad", "version": "0.2", "sha256": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}
}
```

Cet exemple est synthétique. Les références désignent les versions validées ;
le lecteur doit disposer de leur contenu exact par une surface autorisée avant
admission. Une URL ou une empreinte déclarée sans contenu vérifié ne suffit pas.
Le ticket et la milestone appartiennent au projet configuré, le ticket reste
hors milestone, et chaque UUID est relu. Un bloc multiple, inconnu, incomplet,
une référence introuvable ou un ticket déjà engagé provoque un blocage explicite.

La racine native représente le ticket de campagne. Les racines du graphe de
milestone sont rattachées à cette racine **dans Paperclip seulement**. Le document
source conserve les `parentId` Linear d’origine ; un mapping natif distinct décrit
le regroupement technique. Aucun faux parent Linear n’est ajouté aux snapshots.
Parents, descendants et historique restent présents ; seules les feuilles restant
à réaliser deviennent des livraisons. Un membre déjà engagé est refusé en V1.

L2 étend la readiness avec les données campagne : ticket, milestone, références
PRD/TAD, empreinte matérielle et mapping natif. L1 prépare le receveur opt-in.
Le lecteur historique reste compatible ; une ancienne version qui ne comprend
pas ces données doit les refuser, jamais traiter une milestone comme un Todo simple.
L’empreinte matérielle couvre contenu, membres, parenté, dépendances et références.
Les statuts/commentaires du plugin et leurs timestamps n’y entrent pas ; les
états humains incompatibles sont contrôlés séparément, sans élargissement du scope.

## Réutilisation des échanges Council

Conserver les deux échanges prévus au TAD et les événements natifs existants.
Le protocole initial `linear-intake-revalidation-request.v1` continue de couvrir
préparation/admission ; le challenge de continuité existant couvre ensuite
source actuelle et publications. Les tables restent privées à leur plugin.

Pour la campagne V1, une politique explicite `milestone-fixed-v1` distingue :

- une source fixée, des commandes exclusivement natives et un nettoyage Git manuel ;
- les capacités réellement fournies : `fixed-source` et `publication-readback` ;
- une identité de campagne liée à la demande/mission, jamais à la seule activation
  qui peut être commune à plusieurs demandes ;
- des intentions de publication persistées, chacune avec son ID et son empreinte,
  reprises sous la même identité par le job existant.

La réponse V1 ne porte aucune commande Linear ni adoption de contexte. Les
réponses du protocole historique restent validées selon leur contrat existant.
Une capacité absente ou une réponse du mauvais mode bloque la campagne avant effet.
La liaison originale société/projet/intake/source/mandat reste contrôlée dans
l’enveloppe authentifiée et dans les documents relus.

| Exemple de contrat | Résultat attendu |
| --- | --- |
| Source complète, exacte, mode V1, aucune publication encore demandée | Observation recevable ; l’admission exige encore mandat, occupation et plan publié. |
| Même demande rejouée | Même campagne/occupation ; aucun nouveau budget ou objet. |
| Contenu matériel changé | Suspension ; aucune adoption de nouvelle empreinte dans la campagne. |
| Commentaire du plugin ajouté, contenu matériel identique | Pas de changement de portée ; contrôler séparément le readback attendu. |
| Accusé pour intention connue et contenu exact, avec readback de chaque effet | Publication confirmable. |
| Même ID d’intention, contenu différent ; faux émetteur ; mauvais objet ; lecture partielle | Refus, aucun effet/accusé fabriqué. |
| Réponse perdue après commentaire envoyé | Recherche de l’effet original ; état inconnu tant que non concluante, aucun nouvel envoi aveugle. |
| Révocation d’écriture | Lecture conservée ; progression nécessitant publication suspendue. |

L1/L3 transcrivent ces exemples en fixtures communes aux consommateurs concernés.
La politique reste désactivée par défaut. Son ajout n’autorise pas l’activation
des commandes/contextes automatiques ou du nettoyage Git historiques.

## Pilote et sortie de L0

L’utilisateur a désigné l’instance Paperclip **de recette**, le projet Linear
**Content Assistant** et son dépôt WSL. Il reste à relever société, IDs exacts,
gateway/profils/références natives de secrets, mandat, budget et objets du pilote.
Aucune valeur de secret ne doit figurer dans les preuves.

Le pilote sera une milestone de deux livraisons ordonnées avec un critère
transversal vérifiable, un ticket de campagne extérieur à la milestone et un
périmètre de fichiers/PR explicitement borné. Les données métier et la branche de
test doivent être fixées avant les effets réels. Le cas nominal A01 sera réel ;
les refus/reprises A02–A08 réutiliseront les preuves isolées à la couche appropriée.

**L0 statique terminé.** Q1/Q2 restent ouvertes pour les opérations gateway
nouvelles ; elles ne bloquent pas les fonctions déterministes sur fixtures mais
bloquent leur activation. Q3 a ses réutilisations et propriétaires précis ; Q4
a sa cible choisie et sa recette à matérialiser. Les manques ne sont pas présentés
comme des capacités acquises.

La classification `linear-campaign-v1` est `cross-plugin`, propriétaire
intégration pour source/publication et Council pour autorité/consommation,
surfaces source/readiness, revalidation/publication, admission/continuité,
livraisons/complétion ; séquence L0 → L1 → L2 → L3 → L4 → L5, `split-required`.
Le gate exécutable `prewrite_migration_gate.py` a accepté ce découpage avant les
précisions contractuelles de cette note. Les écritures source de chaque lot
revalideront leurs surfaces et leurs tests propres.
