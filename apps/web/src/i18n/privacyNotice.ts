// Slice 12: the privacy notice text. Plain strings rendered by React (never as HTML).
// English is the canonical source; es and da follow it.
import type { Lang } from "./messages";
import { privacyCa } from "./ca/privacy";

/** Date shown as "Last updated". Change this single value when the text changes (and at merge time). */
export const PRIVACY_LAST_UPDATED = "2026-11-19";

export type PrivacySection = { heading: string; lines: string[] };
export type PrivacyNotice = { title: string; updatedLabel: string; sections: PrivacySection[] };

const en: PrivacyNotice = {
  title: "Privacy notice",
  updatedLabel: "Last updated",
  sections: [
    {
      heading: "Who is responsible",
      lines: ["leyenda.ink is responsible for your data.", "It is in a closed test and not yet open to the public. For privacy requests, write to contact@leyenda.ink."],
    },
    {
      heading: "If you visit event maps",
      lines: [
        "You don't need an account. We don't use advertising or tracking cookies, and we don't build profiles of visitors. To see how many people use leyenda.ink, we use Cloudflare Web Analytics. It sets no cookies and keeps only aggregate counts of the page visited, the page you came from (referrer), your browser and device type, your country and page load performance. It doesn't identify you or follow you across sites.",
        "Your browser only remembers your language and schedule zoom if you change them. That stays on your device.",
        "Your IP address is used for about one minute to protect the service from abuse (rate limiting), to show events near you first, and to pick a default language (Catalan if you're in Catalonia) (approximate location from your IP). leyenda.ink itself doesn't store it.",
        'If you tap "Add to Google Calendar", Google receives that event\'s details.',
      ],
    },
    {
      heading: "If you are an organizer or were invited",
      lines: [
        "When you are invited, we store your email to check the invitation. We delete the invitation 30 days after it is used, revoked or expired.",
        "After you accept, your email stays in your organizer account, because we use it to recognize you when you sign in with Google.",
        "When you sign in with Google, we receive and keep your Google account ID, your email and your name. We don't get your password or anything else from your Google account.",
        "A session cookie keeps you signed in for up to 7 days. Expired sessions are removed.",
        "The organizer area (/panel) is also counted by Cloudflare Web Analytics, with the same aggregate data described above. The invitation page is not.",
        "Your events are kept until you delete them. Once an event is published, its information is public. You are responsible for what you publish: please don't include other people's personal data without their permission.",
      ],
    },
    {
      heading: "Why we can do this",
      lines: ["To provide the service you asked for, and our legitimate interest in keeping it secure and free of abuse."],
    },
    {
      heading: "Who helps us",
      lines: [
        "Cloudflare hosts leyenda.ink. Our database is stored in the EU. Some technical logs may be processed outside the EU, protected by the EU–US Data Privacy Framework and standard contractual clauses.",
        "Map images you upload are stored in Cloudflare R2, in the EU. Before they are stored, your browser resizes them and removes location and other metadata (such as GPS and camera details). We delete a map image when you replace it or when you delete the event.",
        "Event cover images you upload are stored in Cloudflare R2, in the EU. Your browser resizes them and removes location and other metadata (such as GPS and camera details) before they are stored. A cover is public as soon as the event is published, and anyone with the link can see it, so please only use pictures you may share. We delete a cover when you replace or remove it, or when you delete the event.",
        "As our hosting provider, Cloudflare records basic data about each request (IP address, approximate country, page requested and time) in its traffic analytics. We can view it for up to about 30 days, only to diagnose problems and stop abuse. We also see overall traffic statistics, such as visits by country, which don't identify anyone.",
        "Google provides sign-in and is responsible for your Google account under its own privacy policy.",
      ],
    },
    {
      heading: "How long we keep data",
      lines: [
        "Sessions: 7 days, then removed.",
        "Invitations: deleted 30 days after they are used, revoked or expired.",
        "Technical logs: 3 days, with an internal ID only (no email or name).",
        "Hosting traffic records (IP address, country, page, time): up to about 30 days, kept by Cloudflare.",
        "Database backups: up to 7 days. Data you delete can remain in backups until then.",
        "Moderation log: when an event is submitted for approval, withdrawn, approved, rejected or unpublished, we record who did it, what happened, when, and the reason if one was given (no IP address). We keep it for 12 months, then delete it.",
        "Your account: until you ask us to delete it.",
      ],
    },
    {
      heading: "Your rights",
      lines: [
        "You can ask to see, correct, export or delete your data, or object to how we use it. You can also complain to the Spanish Data Protection Agency (AEPD, www.aepd.es).",
      ],
    },
    {
      heading: "Cookies and storage",
      lines: [
        "__Host-atlas_oauth: used only while you sign in (10 minutes).",
        "__Host-atlas_session: keeps you signed in (7 days).",
        "atlas.lang and atlas.schedule.zoom: your language and zoom choices, stored in your browser.",
        "atlas.mapIntro.v1: remembers that you have seen the map tip, so it is not shown again.",
        "All of them are strictly necessary or saved only when you choose, so we don't ask for consent.",
      ],
    },
    { heading: "Changes", lines: ["If this notice changes, we update the date above."] },
  ],
};

const es: PrivacyNotice = {
  title: "Aviso de privacidad",
  updatedLabel: "Última actualización",
  sections: [
    {
      heading: "Quién es responsable",
      lines: ["leyenda.ink es responsable de tus datos.", "Está en una prueba cerrada y todavía no está abierto al público. Para consultas de privacidad, escribí a contact@leyenda.ink."],
    },
    {
      heading: "Si visitás mapas de eventos",
      lines: [
        "No necesitás cuenta. No usamos publicidad ni cookies de seguimiento, y no armamos perfiles de quienes nos visitan. Para saber cuánta gente usa leyenda.ink, usamos Cloudflare Web Analytics. No usa cookies y solo guarda conteos agregados de la página visitada, la página de la que venís (referente), tu navegador y tipo de dispositivo, tu país y el rendimiento de carga. No te identifica ni te sigue entre sitios.",
        "Tu navegador solo recuerda tu idioma y el zoom del programa si los cambiás. Eso queda en tu dispositivo.",
        "Tu dirección IP se usa durante aproximadamente un minuto para proteger el servicio de abusos (límite de peticiones), para mostrarte primero los eventos cercanos y para elegir un idioma por defecto (catalán si estás en Cataluña) (ubicación aproximada a partir de la IP). leyenda.ink en sí no la almacena.",
        'Si tocás "Agregar a Google Calendar", Google recibe los datos de ese evento.',
      ],
    },
    {
      heading: "Si sos organizador o te invitaron",
      lines: [
        "Cuando te invitan, guardamos tu email para comprobar la invitación. Borramos la invitación 30 días después de que se use, se revoque o venza.",
        "Después de que aceptás, tu email queda en tu cuenta de organizador, porque lo usamos para reconocerte cuando entrás con Google.",
        "Cuando entrás con Google, recibimos y guardamos el identificador de tu cuenta de Google, tu email y tu nombre. No recibimos tu contraseña ni nada más de tu cuenta.",
        "Una cookie de sesión te mantiene conectado hasta 7 días. Las sesiones vencidas se eliminan.",
        "El panel de organizadores (/panel) también se mide con Cloudflare Web Analytics, con los mismos datos agregados descritos arriba. La página de invitación no.",
        "Tus eventos se guardan hasta que los borres. Cuando un evento se publica, su información es pública. Sos responsable de lo que publicás: no incluyas datos personales de otras personas sin su permiso.",
      ],
    },
    {
      heading: "Por qué podemos hacerlo",
      lines: ["Para darte el servicio que pediste, y por nuestro interés legítimo en mantenerlo seguro y libre de abusos."],
    },
    {
      heading: "Quién nos ayuda",
      lines: [
        "Cloudflare aloja leyenda.ink. Nuestra base de datos está en la UE. Algunos registros técnicos pueden procesarse fuera de la UE, protegidos por el Marco de Privacidad de Datos UE–EE. UU. y cláusulas contractuales tipo.",
        "Las imágenes de mapa que subís se guardan en Cloudflare R2, en la UE. Antes de guardarlas, tu navegador las achica y les quita la ubicación y otros metadatos (como el GPS y los datos de la cámara). Borramos la imagen de un mapa cuando la reemplazás o cuando eliminás el evento.",
        "Las imágenes de portada de tus eventos se guardan en Cloudflare R2, en la UE. Tu navegador las achica y les quita la ubicación y otros metadatos (como el GPS y los datos de la cámara) antes de guardarlas. Una portada es pública apenas se publica el evento y la puede ver cualquiera que tenga el enlace, así que usá solo fotos que puedas compartir. Borramos la portada cuando la reemplazás o la quitás, o cuando eliminás el evento.",
        "Como nuestro proveedor de hosting, Cloudflare registra datos básicos de cada solicitud (dirección IP, país aproximado, página solicitada y hora) en su analítica de tráfico. Podemos verlos durante hasta unos 30 días, solo para diagnosticar problemas y frenar abusos. También vemos estadísticas generales de tráfico, como las visitas por país, que no identifican a nadie.",
        "Google ofrece el inicio de sesión y es responsable de tu cuenta de Google según su propia política de privacidad.",
      ],
    },
    {
      heading: "Cuánto tiempo guardamos los datos",
      lines: [
        "Sesiones: 7 días, después se eliminan.",
        "Invitaciones: se borran 30 días después de que se usen, se revoquen o venzan.",
        "Registros técnicos: 3 días, solo con un identificador interno (sin email ni nombre).",
        "Registros de tráfico del hosting (dirección IP, país, página, hora): hasta unos 30 días, conservados por Cloudflare.",
        "Copias de seguridad de la base de datos: hasta 7 días. Lo que borres puede seguir en las copias hasta entonces.",
        "Registro de moderación: cuando un evento se envía a aprobación, se retira, se aprueba, no se aprueba o se despublica, guardamos quién lo hizo, qué pasó, cuándo y el motivo si se dio uno (sin dirección IP). Lo conservamos 12 meses y después lo borramos.",
        "Tu cuenta: hasta que nos pidas borrarla.",
      ],
    },
    {
      heading: "Tus derechos",
      lines: [
        "Podés pedir ver, corregir, exportar o borrar tus datos, u oponerte a cómo los usamos. También podés reclamar ante la Agencia Española de Protección de Datos (AEPD, www.aepd.es).",
      ],
    },
    {
      heading: "Cookies y almacenamiento",
      lines: [
        "__Host-atlas_oauth: solo mientras iniciás sesión (10 minutos).",
        "__Host-atlas_session: te mantiene conectado (7 días).",
        "atlas.lang y atlas.schedule.zoom: tus elecciones de idioma y zoom, guardadas en tu navegador.",
        "atlas.mapIntro.v1: recuerda que ya viste la pista del mapa, para no mostrártela otra vez.",
        "Todas son estrictamente necesarias o se guardan solo cuando vos elegís, por eso no pedimos consentimiento.",
      ],
    },
    { heading: "Cambios", lines: ["Si este aviso cambia, actualizamos la fecha de arriba."] },
  ],
};

const da: PrivacyNotice = {
  title: "Privatlivspolitik",
  updatedLabel: "Sidst opdateret",
  sections: [
    {
      heading: "Hvem er ansvarlig",
      lines: ["leyenda.ink er ansvarlig for dine data.", "Det er i en lukket test og er endnu ikke åbent for offentligheden. Skriv til contact@leyenda.ink ved anmodninger om privatliv."],
    },
    {
      heading: "Hvis du besøger begivenhedskort",
      lines: [
        "Du behøver ikke en konto. Vi bruger ikke reklamer eller sporingscookies, og vi opbygger ikke profiler af besøgende. For at se, hvor mange der bruger leyenda.ink, bruger vi Cloudflare Web Analytics. Det sætter ingen cookies og gemmer kun samlede tal for den besøgte side, siden du kom fra (henvisning), din browser og enhedstype, dit land og sidens indlæsningshastighed. Det identificerer dig ikke og følger dig ikke på tværs af websteder.",
        "Din browser husker kun dit sprog og zoom i programmet, hvis du ændrer dem. Det bliver på din enhed.",
        "Din IP-adresse bruges i cirka et minut for at beskytte tjenesten mod misbrug (begrænsning af antal forespørgsler), for at vise begivenheder tæt på dig først og for at vælge et standardsprog (catalansk, hvis du er i Catalonien) (omtrentlig placering ud fra din IP). leyenda.ink gemmer den ikke selv.",
        'Hvis du trykker på "Føj til Google Kalender", modtager Google oplysningerne om den begivenhed.',
      ],
    },
    {
      heading: "Hvis du er arrangør eller er blevet inviteret",
      lines: [
        "Når du bliver inviteret, gemmer vi din e-mail for at kontrollere invitationen. Vi sletter invitationen 30 dage efter, at den er brugt, trukket tilbage eller udløbet.",
        "Når du har accepteret, bliver din e-mail liggende på din arrangørkonto, fordi vi bruger den til at genkende dig, når du logger ind med Google.",
        "Når du logger ind med Google, modtager og gemmer vi dit Google-konto-ID, din e-mail og dit navn. Vi får ikke din adgangskode eller andet fra din Google-konto.",
        "En sessionscookie holder dig logget ind i op til 7 dage. Udløbne sessioner fjernes.",
        "Arrangørområdet (/panel) tælles også af Cloudflare Web Analytics med de samme samlede data som beskrevet ovenfor. Invitationssiden gør det ikke.",
        "Dine begivenheder gemmes, indtil du sletter dem. Når en begivenhed er udgivet, er dens oplysninger offentlige. Du er ansvarlig for det, du udgiver: lad være med at medtage andres personoplysninger uden deres tilladelse.",
      ],
    },
    {
      heading: "Hvorfor vi må gøre det",
      lines: ["For at levere den tjeneste, du har bedt om, og af hensyn til vores legitime interesse i at holde den sikker og fri for misbrug."],
    },
    {
      heading: "Hvem hjælper os",
      lines: [
        "Cloudflare hoster leyenda.ink. Vores database er gemt i EU. Nogle tekniske logge kan blive behandlet uden for EU, beskyttet af EU–USA-rammen for databeskyttelse og standardkontraktbestemmelser.",
        "Kortbilleder, du uploader, gemmes i Cloudflare R2 i EU. Før de gemmes, gør din browser dem mindre og fjerner lokation og andre metadata (som GPS og kameraoplysninger). Vi sletter et kortbillede, når du erstatter det, eller når du sletter eventet.",
        "Forsidebilleder til dine events gemmes i Cloudflare R2 i EU. Din browser gør dem mindre og fjerner lokation og andre metadata (som GPS og kameraoplysninger), før de gemmes. Et forsidebillede er offentligt, så snart eventet er offentliggjort, og alle med linket kan se det, så brug kun billeder, du må dele. Vi sletter et forsidebillede, når du erstatter eller fjerner det, eller når du sletter eventet.",
        "Som vores hostingudbyder registrerer Cloudflare grundlæggende data om hver forespørgsel (IP-adresse, omtrentligt land, den ønskede side og tidspunkt) i sin trafikanalyse. Vi kan se dem i op til cirka 30 dage, kun for at finde fejl og stoppe misbrug. Vi ser også samlede trafikstatistikker, f.eks. besøg fordelt på lande, som ikke identificerer nogen.",
        "Google leverer login og er ansvarlig for din Google-konto i henhold til sin egen privatlivspolitik.",
      ],
    },
    {
      heading: "Hvor længe vi gemmer data",
      lines: [
        "Sessioner: 7 dage, derefter fjernes de.",
        "Invitationer: slettes 30 dage efter, at de er brugt, trukket tilbage eller udløbet.",
        "Tekniske logge: 3 dage, kun med et internt ID (ingen e-mail eller navn).",
        "Hostingens trafikregistreringer (IP-adresse, land, side, tidspunkt): op til cirka 30 dage, opbevaret af Cloudflare.",
        "Sikkerhedskopier af databasen: op til 7 dage. Data, du sletter, kan blive i sikkerhedskopierne indtil da.",
        "Moderationslog: når en begivenhed sendes til godkendelse, trækkes tilbage, godkendes, afvises eller afpubliceres, gemmer vi hvem der gjorde det, hvad der skete, hvornår og begrundelsen, hvis der er en (ingen IP-adresse). Vi opbevarer den i 12 måneder og sletter den derefter.",
        "Din konto: indtil du beder os om at slette den.",
      ],
    },
    {
      heading: "Dine rettigheder",
      lines: [
        "Du kan bede om at se, rette, eksportere eller slette dine data eller gøre indsigelse mod, hvordan vi bruger dem. Du kan også klage til den spanske databeskyttelsesmyndighed (AEPD, www.aepd.es).",
      ],
    },
    {
      heading: "Cookies og lagring",
      lines: [
        "__Host-atlas_oauth: bruges kun, mens du logger ind (10 minutter).",
        "__Host-atlas_session: holder dig logget ind (7 dage).",
        "atlas.lang og atlas.schedule.zoom: dine valg af sprog og zoom, gemt i din browser.",
        "atlas.mapIntro.v1: husker, at du har set kortets tip, så det ikke vises igen.",
        "Alle er strengt nødvendige eller gemmes kun, når du vælger det, så vi beder ikke om samtykke.",
      ],
    },
    { heading: "Ændringer", lines: ["Hvis denne politik ændres, opdaterer vi datoen ovenfor."] },
  ],
};

// Slice 30: the organizer request form (/organizadores). Inserted after the organizer section. The Spanish text avoids second-person verbs
// on purpose, so it reads the same for vos and tú readers.
const ORGANIZER_FORM: Record<Lang, PrivacySection> = {
  en: {
    heading: "If you request a map (organizer form)",
    lines: [
      "Controller: leyenda.ink. Contact for anything about this form: contact@leyenda.ink.",
      "What we collect: the 7 things you type into the form (your name, email, event name, approximate date, city, your role and a message). The last four are optional. We don't store your IP address, device or browser details, or the security-check token with the request.",
      "Why: to answer you and assess your request for an event map. The legal basis is GDPR Article 6(1)(b): steps taken at your request before giving you access.",
      "How long: 12 months, then the request is deleted automatically.",
      "Who helps us: Cloudflare hosts the site and the database (D1), and its Turnstile check tells people from bots; Turnstile processes your IP address and some device and browser signals for that. Resend delivers the email notification we receive when you send the form (all the form fields go in it). Resend is in the United States; the transfer relies on the EU–US Data Privacy Framework and standard contractual clauses.",
      "The notification copy of the request kept in our contact@leyenda.ink mailbox is deleted within 12 months, same as the stored request.",
      "No automated decisions are made about you. The only automatic step is the bot check.",
      "Your rights: access, rectification, erasure, restriction, objection and portability. Write to contact@leyenda.ink. You can also complain to the Spanish Data Protection Agency (AEPD, www.aepd.es) or your local supervisory authority.",
    ],
  },
  es: {
    heading: "Si se pide un mapa (formulario de organizadores)",
    lines: [
      "Responsable: leyenda.ink. Contacto para cualquier consulta sobre este formulario: contact@leyenda.ink.",
      "Datos que se recogen: los 7 que se escriben en el formulario (nombre, email, nombre del evento, fecha aproximada, ciudad, rol en la organización y un mensaje). Los últimos cuatro son opcionales. No guardamos la dirección IP, los datos del dispositivo o del navegador ni el token de la comprobación de seguridad junto con el pedido.",
      "Finalidad: responder y evaluar el pedido de un mapa para un evento. Base legal: artículo 6.1.b del RGPD, medidas previas a dar acceso, aplicadas a petición de la persona interesada.",
      "Plazo de conservación: 12 meses; después el pedido se borra automáticamente.",
      "Quién nos ayuda: Cloudflare aloja el sitio y la base de datos (D1), y su comprobación Turnstile distingue personas de bots; para eso Turnstile procesa la dirección IP y algunas señales del dispositivo y del navegador. Resend entrega el email de aviso que recibimos cuando se envía el formulario (lleva todos los campos). Resend está en Estados Unidos; la transferencia se apoya en el Marco de Privacidad de Datos UE–EE. UU. y en cláusulas contractuales tipo.",
      "La copia del aviso que se conserva en nuestro buzón contact@leyenda.ink se borra en un plazo máximo de 12 meses, igual que el pedido guardado.",
      "No se toman decisiones automatizadas sobre las personas. El único paso automático es la comprobación contra bots.",
      "Derechos: acceso, rectificación, supresión, limitación, oposición y portabilidad. Se ejercen escribiendo a contact@leyenda.ink. También se puede reclamar ante la Agencia Española de Protección de Datos (AEPD, www.aepd.es) o ante la autoridad de control del país de residencia.",
    ],
  },
  da: {
    heading: "Hvis du beder om et kort (arrangørformularen)",
    lines: [
      "Dataansvarlig: leyenda.ink. Kontakt ved alt om denne formular: contact@leyenda.ink.",
      "Hvad vi indsamler: de 7 oplysninger, du skriver i formularen (navn, e-mail, begivenhedens navn, omtrentlig dato, by, din rolle og en besked). De sidste fire er valgfrie. Vi gemmer ikke din IP-adresse, oplysninger om enhed eller browser eller sikkerhedskontrollens token sammen med forespørgslen.",
      "Formål: at svare dig og vurdere din forespørgsel om et kort til en begivenhed. Retsgrundlag: GDPR artikel 6, stk. 1, litra b, foranstaltninger truffet på din anmodning, før du får adgang.",
      "Opbevaring: 12 måneder, derefter slettes forespørgslen automatisk.",
      "Hvem hjælper os: Cloudflare hoster siden og databasen (D1), og dets Turnstile-kontrol skelner mennesker fra bots; til det behandler Turnstile din IP-adresse og nogle signaler fra enhed og browser. Resend leverer den e-mailnotifikation, vi får, når formularen sendes (alle formularens felter står i den). Resend er i USA; overførslen bygger på EU–USA-rammen for databeskyttelse og standardkontraktbestemmelser.",
      "Notifikationskopien af forespørgslen i vores postkasse contact@leyenda.ink slettes inden for 12 måneder, ligesom den gemte forespørgsel.",
      "Der træffes ingen automatiske afgørelser om dig. Det eneste automatiske trin er kontrollen mod bots.",
      "Dine rettigheder: indsigt, berigtigelse, sletning, begrænsning, indsigelse og dataportabilitet. Skriv til contact@leyenda.ink. Du kan også klage til den spanske databeskyttelsesmyndighed (AEPD, www.aepd.es) eller til tilsynsmyndigheden i dit land.",
    ],
  },
  ca: {
    heading: "Si demanes un mapa (formulari d'organitzadors)",
    lines: [
      "Responsable: leyenda.ink. Contacte per a qualsevol consulta sobre aquest formulari: contact@leyenda.ink.",
      "Dades que recollim: les 7 que escrius al formulari (nom, correu, nom de l'esdeveniment, data aproximada, ciutat, el teu rol a l'organització i un missatge). Les quatre últimes són opcionals. No desem la teva adreça IP, les dades del dispositiu o del navegador ni el testimoni de la comprovació de seguretat amb la sol·licitud.",
      "Finalitat: respondre't i avaluar la teva sol·licitud d'un mapa per a un esdeveniment. Base legal: article 6.1.b del RGPD, mesures prèvies a donar-te accés, aplicades a petició teva.",
      "Termini de conservació: 12 mesos; després la sol·licitud s'esborra automàticament.",
      "Qui ens ajuda: Cloudflare allotja el lloc i la base de dades (D1), i la seva comprovació Turnstile distingeix persones de bots; per a això Turnstile processa l'adreça IP i alguns senyals del dispositiu i del navegador. Resend lliura el correu d'avís que rebem quan s'envia el formulari (hi van tots els camps). Resend és als Estats Units; la transferència es basa en el Marc de Privacitat de Dades UE–EUA i en clàusules contractuals tipus.",
      "La còpia de l'avís que es conserva a la nostra bústia contact@leyenda.ink se suprimeix en un termini màxim de 12 mesos, igual que la sol·licitud desada.",
      "No es prenen decisions automatitzades sobre tu. L'únic pas automàtic és la comprovació contra bots.",
      "Drets: accés, rectificació, supressió, limitació, oposició i portabilitat. Escriu a contact@leyenda.ink. També pots reclamar davant l'Agència Espanyola de Protecció de Dades (AEPD, www.aepd.es) o davant l'autoritat de control del teu país.",
    ],
  },
};

/** Inserts the organizer-form section right after "If you are an organizer or were invited" (third section). */
function withOrganizerForm(n: PrivacyNotice, lang: Lang): PrivacyNotice {
  const sections = [...n.sections];
  sections.splice(3, 0, ORGANIZER_FORM[lang]);
  return { ...n, sections };
}

export const PRIVACY_NOTICE: Record<Lang, PrivacyNotice> = {
  es: withOrganizerForm(es, "es"),
  en: withOrganizerForm(en, "en"),
  da: withOrganizerForm(da, "da"),
  ca: withOrganizerForm(privacyCa, "ca"),
};

