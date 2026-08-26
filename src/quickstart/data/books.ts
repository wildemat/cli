/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Bundled sample dataset for the quickstart value moment.
 *
 * Books, to match the docs quickstart and the Elastic Bookshop reference app
 * (`description` is the semantic field; `title` and `release_year` support
 * full-text search and aggregation). Descriptions are deliberately written so
 * the demo query ("a story about a girl growing up") matches coming-of-age books on
 * *meaning* while BM25 latches onto incidental keyword overlap elsewhere
 * (titles and blurbs containing "story", "girl", or "growing" that are not
 * coming-of-age books at all).
 *
 * Final dataset content/hosting is an open product dependency; swap via the
 * loader in `dataset.ts` without touching the flow.
 */

export interface BookDoc {
  title: string
  author: string
  release_year: number
  genre: string
  description: string
}

export const BOOKS: BookDoc[] = [
  // --- semantic targets: coming-of-age, phrased without the query's words ---
  { title: 'To Kill a Mockingbird', author: 'Harper Lee', release_year: 1960, genre: 'classic', description: 'Through the eyes of young Scout Finch, a sleepy Alabama town confronts prejudice during her father\'s defense of an innocent man, and childhood gives way to a hard-won moral awakening.' },
  { title: 'The Catcher in the Rye', author: 'J.D. Salinger', release_year: 1951, genre: 'classic', description: 'Expelled from prep school, teenage Holden Caulfield drifts through New York City, railing against phoniness while quietly falling apart on the uneasy threshold of adulthood.' },
  { title: 'Little Women', author: 'Louisa May Alcott', release_year: 1868, genre: 'classic', description: 'Four sisters in Civil War-era New England navigate poverty, ambition, first love, and grief as they mature from girlhood into four very different women.' },
  { title: 'Great Expectations', author: 'Charles Dickens', release_year: 1861, genre: 'classic', description: 'An orphan named Pip rises from the marshes to London society thanks to a secret benefactor, learning through heartbreak and shame what truly makes a gentleman.' },
  { title: 'Anne of Green Gables', author: 'L.M. Montgomery', release_year: 1908, genre: 'classic', description: 'A talkative red-haired orphan upends a staid farm household on Prince Edward Island as her wild imagination slowly ripens into womanhood.' },
  { title: 'The Outsiders', author: 'S.E. Hinton', release_year: 1967, genre: 'young-adult', description: 'Caught between rival gangs divided by class, fourteen-year-old Ponyboy loses his innocence in a spiral of violence and learns to stay gold.' },
  { title: 'A Tree Grows in Brooklyn', author: 'Betty Smith', release_year: 1943, genre: 'classic', description: 'In a poor Williamsburg tenement, bookish Francie Nolan comes of age, pulling herself toward a wider life the way an ailanthus pushes through pavement.' },
  { title: 'The Perks of Being a Wallflower', author: 'Stephen Chbosky', release_year: 1999, genre: 'young-adult', description: 'In letters to a stranger, shy freshman Charlie records first friendships, first love, and buried trauma during a year that carries him toward adulthood.' },
  { title: 'The Kite Runner', author: 'Khaled Hosseini', release_year: 2003, genre: 'literary', description: 'A privileged Kabul boy betrays his loyal friend, and decades later returns to a ruined Afghanistan seeking redemption for the sins of his youth.' },
  { title: 'Jane Eyre', author: 'Charlotte Brontë', release_year: 1847, genre: 'classic', description: 'An orphaned governess endures a cruel childhood and a haunted employer, insisting on her own worth from schoolroom to moorland until she can meet love as an equal.' },
  { title: 'David Copperfield', author: 'Charles Dickens', release_year: 1850, genre: 'classic', description: 'From a blighted boyhood of factory drudgery to literary success, David recounts the friends, frauds, and loves that shaped him into the hero of his own life.' },
  { title: 'The Adventures of Huckleberry Finn', author: 'Mark Twain', release_year: 1884, genre: 'classic', description: 'Rafting down the Mississippi with a runaway slave, an unschooled boy outwits con men and his own conscience, maturing past everything his town taught him.' },
  { title: 'A Portrait of the Artist as a Young Man', author: 'James Joyce', release_year: 1916, genre: 'classic', description: 'Stephen Dedalus passes from Jesuit schoolrooms through guilt and epiphany to the moment a young man chooses art over country and church.' },
  { title: 'The House on Mango Street', author: 'Sandra Cisneros', release_year: 1984, genre: 'literary', description: 'In luminous vignettes, young Esperanza chronicles her Latino neighborhood in Chicago and her fierce wish to leave childhood and its house behind.' },
  { title: 'Persepolis', author: 'Marjane Satrapi', release_year: 2000, genre: 'memoir', description: 'A graphic memoir of an outspoken Iranian girl who comes of age during the Islamic Revolution, between punk records at home and war outside.' },
  { title: 'The Secret Life of Bees', author: 'Sue Monk Kidd', release_year: 2001, genre: 'literary', description: 'Fleeing a harsh father in 1964 South Carolina, fourteen-year-old Lily finds mothers, beekeeping, and her own history in a bright pink house.' },
  { title: 'Are You There God? It\'s Me, Margaret', author: 'Judy Blume', release_year: 1970, genre: 'young-adult', description: 'Sixth-grader Margaret negotiates a new town, first bras, first crushes, and two religions in frank conversations with God about becoming a teenager.' },
  { title: 'Lord of the Flies', author: 'William Golding', release_year: 1954, genre: 'classic', description: 'Marooned schoolboys build their own society on an empty island, and the veneer of civilization peels away from childhood with terrifying speed.' },

  // --- BM25 decoys: "story" / "growing" / "girl" in unrelated books ---
  { title: 'The Neverending Story', author: 'Michael Ende', release_year: 1979, genre: 'fantasy', description: 'A bullied boy steals a mysterious book and is drawn into Fantastica, a dying realm of luckdragons and empresses that only a human wish can save.' },
  { title: 'Love Story', author: 'Erich Segal', release_year: 1970, genre: 'romance', description: 'A wealthy Harvard jock and a sharp-tongued music student marry against his father\'s wishes, and their charmed marriage meets a devastating diagnosis.' },
  { title: 'The Hidden Life of Trees', author: 'Peter Wohlleben', release_year: 2015, genre: 'nonfiction', description: 'A forester explains how trees communicate through root networks, share nutrients, and keep growing for centuries in surprisingly social forests.' },
  { title: 'Lab Girl', author: 'Hope Jahren', release_year: 2016, genre: 'memoir', description: 'A geobiologist\'s memoir of building labs from nothing, told alongside essays about seeds, soil, and what a growing plant risks with every leaf.' },
  { title: 'The Botany of Desire', author: 'Michael Pollan', release_year: 2001, genre: 'nonfiction', description: 'The story of four plants — apples, tulips, cannabis, and potatoes — and how their sweetness, beauty, and usefulness got humans growing them worldwide.' },
  { title: 'West with the Night', author: 'Beryl Markham', release_year: 1942, genre: 'memoir', description: 'A story about horses, bush pilots, and record-setting flight across colonial Kenya and the Atlantic, told by the first woman to fly it solo east to west.' },
  { title: 'The Story of Art', author: 'E.H. Gombrich', release_year: 1950, genre: 'nonfiction', description: 'The classic single-volume survey of Western art, walking from cave paintings to modernism with an unmatched gift for plain explanation.' },
  { title: 'A Brief History of Time', author: 'Stephen Hawking', release_year: 1988, genre: 'science', description: 'A story about the universe itself: black holes, the big bang, and the arrow of time, told for readers without a single equation beyond E=mc².' },

  // --- breadth: fiction across genres ---
  { title: 'Moby-Dick', author: 'Herman Melville', release_year: 1851, genre: 'classic', description: 'Captain Ahab drags the whaler Pequod and its crew into his monomaniacal hunt for the white whale that took his leg.' },
  { title: 'Pride and Prejudice', author: 'Jane Austen', release_year: 1813, genre: 'classic', description: 'Elizabeth Bennet spars with the proud Mr. Darcy through misjudgments, scandals, and proposals in Regency England\'s marriage market.' },
  { title: '1984', author: 'George Orwell', release_year: 1949, genre: 'dystopian', description: 'Under Big Brother\'s total surveillance, a minor party functionary commits the crime of independent thought and pays for it in Room 101.' },
  { title: 'Brave New World', author: 'Aldous Huxley', release_year: 1932, genre: 'dystopian', description: 'In a engineered utopia of test-tube castes and mandatory pleasure, a savage raised outside civilization exposes the cost of comfort.' },
  { title: 'Fahrenheit 451', author: 'Ray Bradbury', release_year: 1953, genre: 'dystopian', description: 'A fireman paid to burn books begins hiding them instead, defecting from a screen-addled society that chose amusement over thought.' },
  { title: 'The Great Gatsby', author: 'F. Scott Fitzgerald', release_year: 1925, genre: 'classic', description: 'A mysterious millionaire throws glittering Long Island parties to win back a married woman, and the American dream curdles into tragedy.' },
  { title: 'One Hundred Years of Solitude', author: 'Gabriel García Márquez', release_year: 1967, genre: 'literary', description: 'Seven generations of the Buendía family found, rule, and haunt the jungle town of Macondo in a century of miracles, wars, and forgetting.' },
  { title: 'Beloved', author: 'Toni Morrison', release_year: 1987, genre: 'literary', description: 'A formerly enslaved mother in post-Civil War Ohio is haunted, literally, by the daughter she killed to keep out of bondage.' },
  { title: 'The Grapes of Wrath', author: 'John Steinbeck', release_year: 1939, genre: 'classic', description: 'Dusted out of Oklahoma, the Joad family drives Route 66 toward California\'s orchards and finds the promised land fenced with wages and clubs.' },
  { title: 'Crime and Punishment', author: 'Fyodor Dostoevsky', release_year: 1866, genre: 'classic', description: 'A destitute St. Petersburg student murders a pawnbroker to prove himself extraordinary, then unravels under guilt and a detective\'s patience.' },
  { title: 'Anna Karenina', author: 'Leo Tolstoy', release_year: 1878, genre: 'classic', description: 'A married aristocrat\'s affair with a cavalry officer scandalizes imperial Russia, mirrored by a landowner\'s search for a life worth living.' },
  { title: 'Wuthering Heights', author: 'Emily Brontë', release_year: 1847, genre: 'classic', description: 'On the Yorkshire moors, the foundling Heathcliff and Catherine Earnshaw destroy two families with a love closer to possession than tenderness.' },
  { title: 'Frankenstein', author: 'Mary Shelley', release_year: 1818, genre: 'gothic', description: 'A young scientist stitches life into dead flesh, then abandons his creature to loneliness that turns methodically to revenge.' },
  { title: 'Dracula', author: 'Bram Stoker', release_year: 1897, genre: 'gothic', description: 'Told in letters and diaries, a Transylvanian count\'s move to London is opposed by a band of friends armed with garlic, science, and stakes.' },
  { title: 'The Picture of Dorian Gray', author: 'Oscar Wilde', release_year: 1890, genre: 'gothic', description: 'A beautiful young man stays flawless while his hidden portrait records every cruelty, aging with each sin he commits.' },
  { title: 'Dune', author: 'Frank Herbert', release_year: 1965, genre: 'science-fiction', description: 'Exiled to the desert planet Arrakis, young Paul Atreides joins the Fremen and becomes the prophet of an interstellar jihad over the spice.' },
  { title: 'Foundation', author: 'Isaac Asimov', release_year: 1951, genre: 'science-fiction', description: 'A mathematician who can statistically predict the future plants two colonies to shorten the dark age after the Galactic Empire\'s fall.' },
  { title: 'Neuromancer', author: 'William Gibson', release_year: 1984, genre: 'science-fiction', description: 'A burned-out hacker is hired for one last run through cyberspace by a dying artificial intelligence trying to free itself.' },
  { title: 'The Left Hand of Darkness', author: 'Ursula K. Le Guin', release_year: 1969, genre: 'science-fiction', description: 'A human envoy on a glacial planet whose people have no fixed sex learns that trust, not treaties, is what joins worlds.' },
  { title: 'The Martian', author: 'Andy Weir', release_year: 2011, genre: 'science-fiction', description: 'Stranded alone on Mars, an astronaut engineers his way through starvation, explosions, and orbital mechanics with duct tape and wit.' },
  { title: 'Snow Crash', author: 'Neal Stephenson', release_year: 1992, genre: 'science-fiction', description: 'A pizza-delivering hacker samurai chases a mind-crashing virus through a privatized America and its virtual Metaverse.' },
  { title: 'The Hobbit', author: 'J.R.R. Tolkien', release_year: 1937, genre: 'fantasy', description: 'Comfortable Bilbo Baggins is swept out his round door by dwarves to burgle a dragon\'s hoard, finding a ring and his nerve along the way.' },
  { title: 'A Game of Thrones', author: 'George R.R. Martin', release_year: 1996, genre: 'fantasy', description: 'Noble houses scheme for an iron throne while an ancient cold threat rises, ignored, beyond a wall of ice in the north.' },
  { title: 'The Name of the Wind', author: 'Patrick Rothfuss', release_year: 2007, genre: 'fantasy', description: 'A legendary arcanist recounts his rise from orphaned trouper to university prodigy hunting the mythic beings who slaughtered his family.' },
  { title: 'The Ocean at the End of the Lane', author: 'Neil Gaiman', release_year: 2013, genre: 'fantasy', description: 'A man returns to his childhood lane and remembers the pond that was an ocean and the ancient women who defended him from something that got in.' },
  { title: 'Circe', author: 'Madeline Miller', release_year: 2018, genre: 'fantasy', description: 'The banished witch of Aiaia narrates her exile among gods and sailors, trading immortal indifference for mortal love and craft.' },
  { title: 'And Then There Were None', author: 'Agatha Christie', release_year: 1939, genre: 'mystery', description: 'Ten strangers lured to an island are executed one by one according to a nursery rhyme, with no killer visible but themselves.' },
  { title: 'The Big Sleep', author: 'Raymond Chandler', release_year: 1939, genre: 'mystery', description: 'Private detective Philip Marlowe wades into a blackmail case for a dying general and finds Los Angeles rotten from orchid house to gutter.' },
  { title: 'Gone Girl', author: 'Gillian Flynn', release_year: 2012, genre: 'thriller', description: 'On their fifth anniversary a wife vanishes, and alternating diaries turn a missing-person case into a duel of unreliable narrators.' },
  { title: 'The Girl with the Dragon Tattoo', author: 'Stieg Larsson', release_year: 2005, genre: 'thriller', description: 'A disgraced journalist and a fierce, antisocial hacker untangle a vanished heiress, a fascist family, and decades of violence against women.' },
  { title: 'The Silence of the Lambs', author: 'Thomas Harris', release_year: 1988, genre: 'thriller', description: 'To profile one serial killer, a young FBI trainee must bargain pieces of herself to another: the brilliant, imprisoned Dr. Lecter.' },
  { title: 'Rebecca', author: 'Daphne du Maurier', release_year: 1938, genre: 'gothic', description: 'An unnamed second wife arrives at Manderley to find the household, and the sinister housekeeper, still ruled by the dead first Mrs. de Winter.' },
  { title: 'The Remains of the Day', author: 'Kazuo Ishiguro', release_year: 1989, genre: 'literary', description: 'An aging English butler motors through the countryside, replaying decades of perfect service to a lord whose politics, and a love unspoken, he misjudged.' },
  { title: 'Never Let Me Go', author: 'Kazuo Ishiguro', release_year: 2005, genre: 'literary', description: 'Students at a secluded English boarding school slowly understand what their bodies are for, and love each other anyway in the time allowed.' },
  { title: 'Life of Pi', author: 'Yann Martel', release_year: 2001, genre: 'literary', description: 'After a shipwreck, an Indian zookeeper\'s son shares a lifeboat with a Bengal tiger for 227 days, or so goes the version worth believing.' },
  { title: 'The Road', author: 'Cormac McCarthy', release_year: 2006, genre: 'literary', description: 'A father and son push a shopping cart south through an ashen, cannibal-haunted America, carrying the fire between them.' },
  { title: 'All the Light We Cannot See', author: 'Anthony Doerr', release_year: 2014, genre: 'historical', description: 'A blind French girl guarding a cursed diamond and a German radio prodigy converge on occupied Saint-Malo as the bombs fall.' },
  { title: 'Wolf Hall', author: 'Hilary Mantel', release_year: 2009, genre: 'historical', description: 'Blacksmith\'s son Thomas Cromwell rises to Henry VIII\'s right hand, engineering a divorce that breaks England from Rome.' },
  { title: 'The Book Thief', author: 'Markus Zusak', release_year: 2005, genre: 'historical', description: 'Narrated by Death, a foster girl in Nazi Germany steals books, shares them with neighbors in bomb shelters, and hides a Jewish boxer in the basement.' },
  { title: 'The Name of the Rose', author: 'Umberto Eco', release_year: 1980, genre: 'mystery', description: 'In a 14th-century abbey, a Franciscan friar applies logic to a string of monk murders that circle a forbidden book in a labyrinthine library.' },
  { title: 'The Handmaid\'s Tale', author: 'Margaret Atwood', release_year: 1985, genre: 'dystopian', description: 'In the theocratic republic of Gilead, a woman reduced to her fertility records small rebellions in a regime built on scripture and surveillance.' },
  { title: 'Things Fall Apart', author: 'Chinua Achebe', release_year: 1958, genre: 'literary', description: 'A proud Igbo wrestler and farmer watches colonial missionaries and courts dismantle everything that made his village and his honor legible.' },
  { title: 'Half of a Yellow Sun', author: 'Chimamanda Ngozi Adichie', release_year: 2006, genre: 'historical', description: 'Twin sisters, a houseboy, and an English writer are swept into the Biafran war for independence and its famine, loyalty tested by each other and history.' },
  { title: 'Norwegian Wood', author: 'Haruki Murakami', release_year: 1987, genre: 'literary', description: 'A Tokyo student in the late sixties is pulled between a fragile woman tied to a shared grief and a vividly alive girl from his drama class.' },
  { title: 'Kafka on the Shore', author: 'Haruki Murakami', release_year: 2002, genre: 'literary', description: 'A runaway teenager and an old man who talks to cats trace parallel odysseys through a Japan where fish rain from the sky and libraries hold fates.' },
  { title: 'The Alchemist', author: 'Paulo Coelho', release_year: 1988, genre: 'fable', description: 'An Andalusian shepherd sells his flock to chase a recurring dream of treasure at the pyramids, learning to read omens on the way.' },
  { title: 'The Little Prince', author: 'Antoine de Saint-Exupéry', release_year: 1943, genre: 'fable', description: 'A pilot downed in the Sahara meets a golden-haired visitor from asteroid B-612 who interrogates grown-up nonsense with devastating simplicity.' },
  { title: 'Charlotte\'s Web', author: 'E.B. White', release_year: 1952, genre: 'children', description: 'A barn spider spins words into her web to save a runt pig from slaughter, spending her one summer on friendship\'s finest trick.' },
  { title: 'Matilda', author: 'Roald Dahl', release_year: 1988, genre: 'children', description: 'A five-year-old genius with negligent parents and a tyrant headmistress discovers her mind can move more than books.' },
  { title: 'Harry Potter and the Philosopher\'s Stone', author: 'J.K. Rowling', release_year: 1997, genre: 'fantasy', description: 'An orphan in a cupboard learns on his eleventh birthday that he is a wizard, and that the dark lord who killed his parents left a mark on him.' },
  { title: 'Educated', author: 'Tara Westover', release_year: 2018, genre: 'memoir', description: 'Raised by survivalists in the Idaho mountains with no schooling, a young woman claws her way to Cambridge and counts what the distance costs her family.' },
  { title: 'Born a Crime', author: 'Trevor Noah', release_year: 2016, genre: 'memoir', description: 'A comedian recounts a South African boyhood in which his own existence, the son of a Black mother and white father under apartheid, was illegal.' },
  { title: 'The Glass Castle', author: 'Jeannette Walls', release_year: 2005, genre: 'memoir', description: 'A journalist recalls a nomadic childhood of brilliant, negligent parents, empty stomachs, and the promise of a dream house never built.' },
  { title: 'Into the Wild', author: 'Jon Krakauer', release_year: 1996, genre: 'nonfiction', description: 'A young college graduate gives his savings to charity, walks into the Alaskan bush with a rifle and a rice bag, and does not walk out.' },
  { title: 'Sapiens', author: 'Yuval Noah Harari', release_year: 2011, genre: 'nonfiction', description: 'A sweeping account of how one primate species conquered the planet through gossip, myths, money, and wheat.' },
  { title: 'Thinking, Fast and Slow', author: 'Daniel Kahneman', release_year: 2011, genre: 'nonfiction', description: 'A Nobel laureate maps the two systems of the mind, the quick intuitive one and the lazy deliberate one, and the biases they trade in.' },
  { title: 'The Immortal Life of Henrietta Lacks', author: 'Rebecca Skloot', release_year: 2010, genre: 'science', description: 'Cells taken without consent from a dying Black woman in 1951 became medicine\'s workhorse line, while her family went uninformed for decades.' },
  { title: 'Silent Spring', author: 'Rachel Carson', release_year: 1962, genre: 'science', description: 'The book that ignited modern environmentalism, documenting how indiscriminate pesticide use was silencing birdsong across America.' },
  { title: 'The Sixth Extinction', author: 'Elizabeth Kolbert', release_year: 2014, genre: 'science', description: 'Field reports from reefs, rainforests, and caves argue that humanity is driving a mass die-off to rival the asteroid that ended the dinosaurs.' },
  { title: 'Project Hail Mary', author: 'Andy Weir', release_year: 2021, genre: 'science-fiction', description: 'A man wakes alone on a starship with no memory, tasked with saving Earth\'s dimming sun, and finds an unlikely engineering partner out there.' },
  { title: 'Klara and the Sun', author: 'Kazuo Ishiguro', release_year: 2021, genre: 'science-fiction', description: 'A solar-powered artificial friend observes the humans she serves with devoted, slightly wrong tenderness, and bargains with the sun for a sick girl.' },
  { title: 'Piranesi', author: 'Susanna Clarke', release_year: 2020, genre: 'fantasy', description: 'A gentle man keeps a journal of an infinite house of statues and tides, unaware of what the only other living person there has taken from him.' },
  { title: 'The Midnight Library', author: 'Matt Haig', release_year: 2020, genre: 'fiction', description: 'Between life and death, a regret-filled woman browses shelves of the lives she might have lived, one book per un-taken choice.' },
  { title: 'Where the Crawdads Sing', author: 'Delia Owens', release_year: 2018, genre: 'fiction', description: 'Abandoned in a North Carolina marsh, a girl raises herself on mussels and gull calls, then stands trial when the town golden boy turns up dead.' },
  { title: 'A Man Called Ove', author: 'Fredrik Backman', release_year: 2012, genre: 'fiction', description: 'A cantankerous widower\'s meticulously planned exit keeps getting interrupted by pregnant neighbors, a stray cat, and other people\'s problems.' },
  { title: 'Lessons in Chemistry', author: 'Bonnie Garmus', release_year: 2022, genre: 'fiction', description: 'Forced out of the lab in 1960s California, a chemist turns a TV cooking show into covert instruction in science and self-respect.' },
  { title: 'Tomorrow, and Tomorrow, and Tomorrow', author: 'Gabrielle Zevin', release_year: 2022, genre: 'fiction', description: 'Two friends build video game worlds together across thirty years of collaboration, love withheld, tragedy, and creative jealousy.' },
]
