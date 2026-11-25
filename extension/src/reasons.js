// Why each supported outlet is boycotted: one documented criticism of its Gaza coverage, said no
// more strongly than its source says it, with the source. Shown by the status bar the first time
// a reader reads the outlet with the extension, and always in the toolbar menu.
//
// From the project's outlet research (media_outlets_documented_consent_criticism.csv), checked
// against each source in Nov 2026, all but one first-hand (see the Toronto Star):
// - FAIR, "Western Media Manufactured Consent for Israel's Murder of Palestinian Journalists"
//   (Aug 2025): 15 outlets' first reports on the Aug 10, 2025 strike that killed Al Jazeera's
//   journalists in Gaza. NYT, LA Times, WSJ, FT, CNN, Newsweek and Reuters are among the 15.
// - FAIR, "When Palestinians Die in Israeli Captivity…" (Sep 2025): one USA Today front page
//   (two Israeli captives named on A1), as an example. The thinnest of the reasons.
// - Media Bias Meter, "Framing Gaza" (2025): 54,449 articles from eight outlets, Oct 2023 to
//   Aug 2025, among them The Globe and Mail, Der Spiegel, Le Monde, Corriere della Sera and La
//   Libre Belgique; it found "a systemic distortion … that favors Israeli framing while
//   marginalizing Palestinian perspectives".
// - Atmos (Jun 2024): a Graeme Wood article in The Atlantic.
// - "When Genocide Wasn't News" (The Breach, 2025), as reviewed by rabble.ca: the Toronto Star
//   among the outlets named. NOT CONFIRMED FIRST-HAND: rabble.ca puts scripted readers through a
//   bot check, and the book's other reviews don't name the Star as a target. Confirm it in a
//   browser, or move thestar to NO_REASON.
// - Canadian Dimension (Sep 2025), an opinion piece on the CBC: one sentence on the National Post.
// - UN Special Rapporteur Irene Khan, A/79/319 (Aug 2024): twenty journalists at the Herald and
//   The Age.
// - Centre for Media Monitoring, "Media Bias: Gaza 2023–24" (2024): Douglas Murray's Spectator
//   column; Mail Online on Herzog's chemical-weapons claim and its share of emotive terms.
// - PolitiFact (Dec 2023): one Jerusalem Post article, published and removed. The Daily Beast (Dec 2,
//   2023) says the same.
// - Mondoweiss (Feb 2024), an opinion piece by Jonathan Ofir on Haaretz: a lifestyle article and two
//   on al-Shifa Hospital and UNRWA. Others call Haaretz the exception in Israel's press (Mother
//   Jones, Oct 2025; The Seventh Eye, below), and Israel's cabinet ended its advertising there in
//   2024 (a Reuters Institute paper, Dec 2024), so this is the most contested of the reasons.
// - The Seventh Eye (Aug 2025), an opinion piece by Amnon Yuval: the techniques of Israel's Hebrew
//   press, Yedioth Ahronoth and Ynet named. READ THROUGH A FETCHING SERVICE ONLY: its own
//   page puts the built-in browser through a Cloudflare check. Confirm it in a browser.
// The New Yorker isn't in the research, so it has no reason here (NO_REASON); none is made up.
(function (root) {
  'use strict';

  const FAIR_JOURNALISTS = {
    text: "Named in FAIR's study of 15 outlets' first reports on Israel's killing of Al Jazeera journalists in Gaza, which found they “overwhelmingly centered Israel's narrative.”",
    source: { name: 'FAIR', year: 2025, href: 'https://fair.org/home/western-media-manufactured-consent-for-israels-murder-of-palestinian-journalists/' },
  };
  const FRAMING_GAZA = {
    text: "One of eight outlets in Media Bias Meter's study of 54,449 articles on Gaza, which found their coverage favored Israeli framing and marginalized Palestinian perspectives.",
    source: { name: 'Media Bias Meter', year: 2025, href: 'https://www.mediabiasmeter.com/framing-gaza-media-bias-report-2025' },
  };
  const NINE_LETTER = {
    text: 'A UN Special Rapporteur reported that 20 journalists at The Age and the Herald were barred from covering the war after signing an open letter criticizing Australian coverage of Gaza.',
    source: { name: 'UN Special Rapporteur', year: 2024, href: 'https://www.un.org/unispal/document/report-special-rapporteur-23aug24/' },
  };
  const MERCA2 = {
    text: 'An opinion column in merca2 said El Mundo, ABC, La Razón and COPE had kept a surprisingly indulgent editorial line toward the Israeli government.',
    source: { name: 'merca2', year: 2025, href: 'https://www.merca2.es/2025/10/07/genocidio-israeli-brecha-2238238/' },
  };
  const CFMM ='https://cfmm.org.uk/wp-content/uploads/2024/03/CfMM-Report-Final-MEDIA-BIAS-GAZA-2023-24-ePDF.pdf';

  const REASONS = {
    nyt: FAIR_JOURNALISTS,
    ft: FAIR_JOURNALISTS,
    cnn: FAIR_JOURNALISTS,
    latimes: FAIR_JOURNALISTS,
    newsweek: FAIR_JOURNALISTS,
    wsj: FAIR_JOURNALISTS,
    reuters: FAIR_JOURNALISTS,
    globeandmail: FRAMING_GAZA,
    spiegel: FRAMING_GAZA,
    lemonde: FRAMING_GAZA,
    corriere: FRAMING_GAZA,
    lalibre: FRAMING_GAZA,
    theage: NINE_LETTER,
    smh: NINE_LETTER,
    usatoday: {
      text: 'FAIR cited a USA Today front page naming two Israeli captives, as US media all but ignored Palestinians dying in Israeli custody.',
      source: { name: 'FAIR', year: 2025, href: 'https://fair.org/home/when-palestinians-die-in-israeli-captivity-us-media-almost-never-take-note/' },
    },
    atlantic: {
      text: "Atmos cited a Graeme Wood article here as manufacturing consent: it cast doubt on Gaza's civilian death toll and discussed “the possibility of killing children legally.”",
      source: { name: 'Atmos', year: 2024, href: 'https://atmos.earth/political-landscapes/why-we-must-witness-the-palestinian-genocide/' },
    },
    thestar: {
      text: "The book When Genocide Wasn't News names the Star among the Canadian outlets that under-reported Israel's assault on Gaza.",
      source: { name: 'rabble.ca', year: 2025, href: 'https://rabble.ca/books/when-genocide-wasnt-news-highlights-the-moral-failings-of-the-mainstream-media/' },
    },
    nationalpost: {
      text: "An opinion piece in Canadian Dimension said Postmedia's papers all push “a uniform pro-Israel editorial line,” and called the National Post its flagship.",
      source: { name: 'Canadian Dimension', year: 2025, href: 'https://canadiandimension.com/articles/view/on-gaza-canadas-public-broadcaster-betrays-its-mandate' },
    },
    spectator: {
      text: 'The Centre for Media Monitoring flagged a Spectator column by Douglas Murray that “appeared to call for ethnic cleansing” of Gaza.',
      source: { name: 'Centre for Media Monitoring', year: 2024, href: CFMM },
    },
    dailymail: {
      text: "The Centre for Media Monitoring found Mail Online ran Israel's unverified chemical-weapons claim unchallenged, and carried a third of the emotive terms in its sample.",
      source: { name: 'Centre for Media Monitoring', year: 2024, href: CFMM },
    },
    // Batch 6 (rows added to the research on 2026-11-16, each source opened that day). NRC has
    // no figure of its own in the study's summary; The Independent's rests on one front page;
    // ABC's and El Mundo's on one opinion column.
    nrc: {
      text: 'One of seven Dutch outlets in an Erasmus University study of 17,000 articles on Gaza, which found Israeli sources quoted one and a half times as often as Palestinian ones.',
      source: { name: 'Erasmus University Rotterdam', year: 2026, href: 'https://www.eur.nl/en/news/large-scale-media-study-coverage-gaza-dutch-media-favours-israel' },
    },
    independent: {
      text: 'The Centre for Media Monitoring named The Independent among five papers whose front pages amplified the unconfirmed claim that 40 babies had been beheaded.',
      source: { name: 'Centre for Media Monitoring', year: 2024, href: CFMM },
    },
    abces: MERCA2,
    elmundo: MERCA2,
    // Batch 7, the Israeli outlets (not in the research, except The Jerusalem Post).
    haaretz: {
      text: "An opinion piece in Mondoweiss said it “published and promoted some of the most harmful propaganda” in support of Israel's genocide in Gaza, citing articles on al-Shifa Hospital and UNRWA.",
      source: { name: 'Mondoweiss', year: 2024, href: 'https://mondoweiss.net/2024/02/how-haaretz-has-aided-israels-genocide-in-gaza/' },
    },
    jpost: {
      text: 'PolitiFact reported that it published an article claiming a dead Palestinian baby was a doll, then took it down and blamed “faulty sourcing.”',
      source: { name: 'PolitiFact', year: 2023, href: 'https://www.politifact.com/factchecks/2023/dec/08/tiktok-posts/no-a-palestinian-man-holding-his-deceased-grandson' },
    },
    ynet: {
      text: 'An opinion piece in The Seventh Eye, an Israeli media watchdog, named Ynet among the outlets whose techniques make atrocities in Gaza disappear from view.',
      source: { name: 'The Seventh Eye', year: 2025, href: 'https://www.the7eye.org.il/560629' },
    },
  };

  // Sites with no documented reason yet: they get no "why", and a test keeps every other site
  // covered.
  const NO_REASON = ['newyorker'];

  const reasonFor = id => REASONS[id] || null;
  const reasons = { REASONS, NO_REASON, reasonFor };
  root.NYTFix = Object.assign(root.NYTFix || {}, { reasons });
  if (typeof module === 'object' && module.exports) module.exports = reasons;
})(globalThis);
