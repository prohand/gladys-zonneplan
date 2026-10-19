# Zonneplan pour Gladys Assistant

Cette intégration amène votre compte [Zonneplan](https://www.zonneplan.nl) dans Gladys :
les prix dynamiques de l'électricité et du gaz, et les équipements suivis par Zonneplan —
compteur P1 (Zonneplan Connect), panneaux solaires, batterie domestique (Nexus) et borne
de recharge.

Elle passe par les serveurs de Zonneplan sur Internet (**cloud**) : rien à installer sur
votre réseau. Elle demande **Gladys 5.1 ou plus récent**.

## Se connecter

Zonneplan n'a pas de mot de passe : il vous envoie un code à usage unique par e-mail.

1. Dans **Intégrations → Zonneplan → Configuration**, saisissez l'adresse e-mail de votre
   compte Zonneplan et **enregistrez**.
2. Cliquez sur **M’envoyer un code de connexion**. Zonneplan vous envoie un code par e-mail.
3. Saisissez le code dans **Se connecter avec le code**, puis validez. Le code est valable
   quelques minutes : s'il a expiré, demandez-en un nouveau.

La réponse sous le bouton liste ce qui a été trouvé sur votre compte. La session se
renouvelle ensuite toute seule ; il ne faut se reconnecter que si elle est fermée (par
exemple depuis l'application Zonneplan). **Tester la connexion** vérifie la session à tout
moment, **Se déconnecter** la supprime de Gladys.

## Réglages

| Réglage                            | Rôle                                                                                                                                                                            |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E-mail du compte Zonneplan         | L'adresse à laquelle le code de connexion est envoyé.                                                                                                                           |
| Créneaux de prix                   | **Par heure** (par défaut) ou **par quart d'heure** : depuis octobre 2025, le marché fixe un prix toutes les 15 minutes ; Zonneplan publie aussi des moyennes horaires.         |
| Intervalle de rafraîchissement (s) | Fréquence de lecture du compteur P1, des panneaux, de la batterie et de la borne (60 à 3600 s, 300 par défaut). Zonneplan limite le nombre d'appels : gardez 300 s sauf besoin. |

## Appareils

Ouvrez l'onglet **Découverte** de l'intégration et créez les appareils voulus. Il y a un
appareil par installation de votre compte :

| Appareil                    | Fonctionnalités                                                                                                     |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Zonneplan electricity price | Prix du kWh maintenant, prix du créneau suivant, tranche tarifaire (`low` / `normal` / `high`), énergie durable (%) |
| Zonneplan gas price         | Prix du m³ aujourd'hui, prix du lendemain (dès qu'il est connu)                                                     |
| Zonneplan P1 meter          | Puissance tirée du réseau, puissance renvoyée au réseau (W)                                                         |
| Zonneplan solar panels      | Puissance produite (W), production totale (kWh)                                                                     |
| Zonneplan home battery      | Niveau de la batterie (%), puissance de charge, puissance de décharge (W)                                           |
| Zonneplan charge point      | Puissance de recharge (W), énergie de la session (kWh), interrupteur **Charge now (boost)**                         |

Les prix incluent la TVA et les taxes, comme dans l'application Zonneplan. Le prix de
l'électricité change pile au début de chaque créneau. Les mesures P1 et solaires passent
par le cloud de Zonneplan toutes les quelques minutes : ce ne sont pas des mesures à la
seconde.

L'interrupteur **Charge now** lance une recharge immédiate (pleine puissance tout de suite,
quel que soit le prix) ; l'éteindre arrête la recharge. En dehors d'une recharge immédiate,
Zonneplan recharge lui-même aux heures creuses, et l'interrupteur est sur ON pendant une
telle recharge.

Chaque appareil porte un badge **cloud**. Un point orange dessus signifie que Zonneplan a
demandé de ralentir les appels pour un moment ; les données reviennent seules.

## Scènes

### Déclencheurs

| Déclencheur                           | Quand                                                                 | Variables                                                    |
| ------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------ |
| Tranche tarifaire Zonneplan changée   | Le nouveau créneau est dans une autre tranche ; filtre sur la tranche | nouvelle tranche, tranche précédente, prix                   |
| Prix Zonneplan négatif                | Le prix de l'électricité vient de passer sous zéro                    | prix, fin du créneau (HH:mm)                                 |
| Prix Zonneplan de demain publiés      | Les prix de demain sont connus (en général l'après-midi)              | date, créneau et prix le moins cher et le plus cher, moyenne |
| Recharge Zonneplan démarrée / arrêtée | Une borne commence ou arrête de recharger ; filtre sur la borne       | puissance, énergie de la session                             |

### Actions

| Action                                      | Rôle                                                                                                                                                                                  |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lire le prix Zonneplan                      | Donne le prix actuel et suivant, la tranche, la part durable et le créneau le moins cher du jour                                                                                      |
| Trouver la période Zonneplan la moins chère | La suite de créneaux consécutifs la moins chère de la durée voulue (en heures) dans les heures à venir : début, fin, prix moyen, « commence dans » (minutes), « commence maintenant » |
| Zonneplan : recharger maintenant            | Recharge immédiate sur la borne choisie                                                                                                                                               |
| Zonneplan : arrêter la recharge             | Arrête la recharge de la borne choisie                                                                                                                                                |

Exemple — lancer le lave-vaisselle pendant les 2 heures les moins chères de la nuit : une
scène déclenchée à 22:00 exécute **Trouver la période Zonneplan la moins chère** (durée 2,
dans les 10), attend **commence dans** minutes puis allume la prise du lave-vaisselle.

Exemple — recharger la voiture quand le prix devient négatif : déclencheur **Prix Zonneplan
négatif**, action **Zonneplan : recharger maintenant**.

Les heures (HH:mm) sont celles des Pays-Bas.

## Widgets

Ajoutez-les depuis **Tableau de bord → Modifier → Ajouter un widget** :

- **Prix Zonneplan** : prix maintenant et ensuite (en couleur selon la tranche), part
  durable, courbe des prix des heures à venir avec le créneau le moins cher et le plus cher
  du jour.
- **Vue d'ensemble Zonneplan** : puissance tirée du réseau et renvoyée, production solaire,
  niveau de batterie et puissance de recharge en direct, la connexion, et les boutons
  **Recharger maintenant** / **Arrêter la recharge**.

## Dépannage

| Message dans l'écran de configuration | Que faire                                                                                     |
| ------------------------------------- | --------------------------------------------------------------------------------------------- |
| Non connecté                          | Suivez [Se connecter](#se-connecter).                                                         |
| La session Zonneplan a expiré         | Demandez un nouveau code : la session a été fermée ou est trop ancienne.                      |
| Zonneplan demande de ralentir         | Rien : les appels reprennent à l'heure indiquée. Augmentez l'intervalle si ça arrive souvent. |
| Zonneplan est injoignable             | Vérifiez l'accès Internet de Gladys ; l'intégration réessaie chaque minute.                   |

Un appareil manque ? Vérifiez que son contrat est actif dans l'application Zonneplan, puis
cliquez sur **Scanner** dans l'onglet Découverte.

## Vie privée

L'intégration ne parle qu'à `app-api.zonneplan.nl`. Les jetons de session sont stockés dans
le volume de données privé de l'intégration, lisibles par elle seule, et jamais écrits dans
les logs. **Se déconnecter** les supprime. Cette intégration n'est ni faite ni supportée par
Zonneplan ; elle utilise la même API que l'application Zonneplan.
