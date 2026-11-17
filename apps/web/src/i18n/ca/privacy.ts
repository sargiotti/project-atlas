// Catalan (ca): the privacy notice text. Plain strings rendered by React (never as HTML). Follows the English source.
import type { PrivacyNotice } from "../privacyNotice";

export const privacyCa: PrivacyNotice = {
  title: "Avís de privacitat",
  updatedLabel: "Última actualització",
  sections: [
    {
      heading: "Qui n'és el responsable",
      lines: ["El projecte Atlas és responsable de les teves dades.", "Atlas és en una prova tancada i encara no és obert al públic. Abans d'obrir-lo, publicarem aquí una adreça de contacte per a consultes de privacitat."],
    },
    {
      heading: "Si visites mapes d'esdeveniments",
      lines: [
        "No cal que tinguis compte. No fem servir publicitat ni galetes de seguiment, i no elaborem perfils de les persones que ens visiten. Per saber quanta gent fa servir Atlas, fem servir Cloudflare Web Analytics. No fa servir galetes i només desa recomptes agregats de la pàgina visitada, la pàgina d'on vens (referent), el teu navegador i tipus de dispositiu, el teu país i el rendiment de càrrega. No t'identifica ni et segueix entre llocs web.",
        "El teu navegador només recorda el teu idioma i el zoom del programa si els canvies. Això es queda al teu dispositiu.",
        "La teva adreça IP es fa servir durant aproximadament un minut per protegir el servei d'abusos (límit de peticions) i per mostrar-te primer els esdeveniments propers (ubicació aproximada a partir de la IP). Atlas en si no la desa.",
        "Si toques \"Afegeix a Google Calendar\", Google rep les dades d'aquest esdeveniment.",
      ],
    },
    {
      heading: "Si ets organitzador o t'han convidat",
      lines: [
        "Quan et conviden, desem el teu correu per comprovar la invitació. Esborrem la invitació 30 dies després que s'hagi fet servir, s'hagi revocat o hagi caducat.",
        "Després que l'acceptis, el teu correu es queda al teu compte d'organitzador, perquè el fem servir per reconèixer-te quan entres amb Google.",
        "Quan entres amb Google, rebem i desem l'identificador del teu compte de Google, el teu correu i el teu nom. No rebem la teva contrasenya ni res més del teu compte.",
        "Una galeta de sessió et manté connectat fins a 7 dies. Les sessions caducades s'eliminen.",
        "El tauler d'organitzadors (/panel) també es mesura amb Cloudflare Web Analytics, amb les mateixes dades agregades descrites més amunt. La pàgina d'invitació no.",
        "Els teus esdeveniments es desen fins que els esborris. Quan un esdeveniment es publica, la seva informació és pública. Ets responsable del que publiques: no hi incloguis dades personals d'altres persones sense el seu permís.",
      ],
    },
    {
      heading: "Per què ho podem fer",
      lines: ["Per donar-te el servei que has demanat, i pel nostre interès legítim a mantenir-lo segur i lliure d'abusos."],
    },
    {
      heading: "Qui ens ajuda",
      lines: [
        "Cloudflare allotja Atlas. La nostra base de dades és a la UE. Alguns registres tècnics es poden processar fora de la UE, protegits pel Marc de Privacitat de Dades UE–EUA i per clàusules contractuals tipus.",
        "Les imatges de mapa que puges es desen a Cloudflare R2, a la UE. Abans de desar-les, el teu navegador les redueix i en treu la ubicació i altres metadades (com el GPS i les dades de la càmera). Esborrem la imatge d'un mapa quan la substitueixes o quan elimines l'esdeveniment.",
        "Les imatges de portada dels teus esdeveniments es desen a Cloudflare R2, a la UE. El teu navegador les redueix i en treu la ubicació i altres metadades (com el GPS i les dades de la càmera) abans de desar-les. Una portada és pública tan bon punt es publica l'esdeveniment i la pot veure qualsevol persona que tingui l'enllaç, així que fes servir només fotos que puguis compartir. Esborrem la portada quan la substitueixes o la treus, o quan elimines l'esdeveniment.",
        "Com a proveïdor d'allotjament, Cloudflare registra dades bàsiques de cada sol·licitud (adreça IP, país aproximat, pàgina sol·licitada i hora) a la seva analítica de trànsit. Les podem veure durant fins a uns 30 dies, només per diagnosticar problemes i frenar abusos. També veiem estadístiques generals de trànsit, com les visites per país, que no identifiquen ningú.",
        "Google ofereix l'inici de sessió i és responsable del teu compte de Google segons la seva pròpia política de privacitat.",
      ],
    },
    {
      heading: "Quant de temps desem les dades",
      lines: [
        "Sessions: 7 dies, després s'eliminen.",
        "Invitacions: s'esborren 30 dies després que s'hagin fet servir, s'hagin revocat o hagin caducat.",
        "Registres tècnics: 3 dies, només amb un identificador intern (sense correu ni nom).",
        "Registres de trànsit de l'allotjament (adreça IP, país, pàgina, hora): fins a uns 30 dies, conservats per Cloudflare.",
        "Còpies de seguretat de la base de dades: fins a 7 dies. El que esborris pot continuar a les còpies fins llavors.",
        "Registre de moderació: quan un esdeveniment s'envia a aprovació, es retira, s'aprova, no s'aprova o es despublica, desem qui ho ha fet, què ha passat, quan i el motiu si se n'ha donat un (sense adreça IP). El conservem 12 mesos i després l'esborrem.",
        "El teu compte: fins que ens demanis d'esborrar-lo.",
      ],
    },
    {
      heading: "Els teus drets",
      lines: [
        "Pots demanar de veure, corregir, exportar o esborrar les teves dades, o oposar-te a com les fem servir. També pots presentar una reclamació davant l'Agencia Española de Protección de Datos (AEPD, www.aepd.es).",
      ],
    },
    {
      heading: "Galetes i emmagatzematge",
      lines: [
        "__Host-atlas_oauth: només mentre inicies la sessió (10 minuts).",
        "__Host-atlas_session: et manté connectat (7 dies).",
        "atlas.lang i atlas.schedule.zoom: les teves eleccions d'idioma i de zoom, desades al teu navegador.",
        "Totes són estrictament necessàries o només es desen quan tu ho tries, per això no demanem consentiment.",
      ],
    },
    { heading: "Canvis", lines: ["Si aquest avís canvia, actualitzem la data de dalt."] },
  ],
};
