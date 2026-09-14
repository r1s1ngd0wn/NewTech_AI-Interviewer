// Seeds a fixed test account (idempotent - checks first) so there's always a known
// login to develop and demo against, plus one completed session so the dashboard
// isn't empty on first look.
const store = require("../store");
const authService = require("../services/authService");
const sessionService = require("../services/sessionService");

const TEST_EMAIL = "test@interviewai.dev";
const TEST_PASSWORD = "password123";
const TEST_NAME = "Test User";

function seedTestAccount() {
  if (store.usersByEmail.has(TEST_EMAIL)) return;

  const { user } = authService.register({
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
    name: TEST_NAME,
  });

  authService.updateProfile(user.id, {
    targetIndustry: "Technology",
    experienceLevel: "Junior",
  });

  const { session } = sessionService.startSession(user.id, "scn_swe_junior_behavioral");
  const answers = [
    "I'm a junior developer with two years of experience in React and Node, and I'm interested in this role because of the team's strong engineering culture and mentorship opportunities.",
    "I disagreed with a teammate about which state management library to use. I listened to their concerns first, then we put together a short comparison together, and we ended up compromising on a solution that addressed both of our concerns.",
    "I'm proud of an internal dashboard I built for our support team as the sole frontend developer. As a result, ticket resolution time dropped by twenty percent, and I learned a lot about performance optimization along the way.",
    "When deadlines are tight, I prioritize tasks by impact first, then communicate early with my manager about any risks, and break the work into smaller steps so nothing feels overwhelming.",
  ];
  for (const answerText of answers) {
    sessionService.submitAnswer(user.id, session.id, answerText);
  }
  sessionService.finishSession(user.id, session.id);

  console.log(`Seeded test account: ${TEST_EMAIL} / ${TEST_PASSWORD}`);
}

module.exports = { seedTestAccount, TEST_EMAIL, TEST_PASSWORD };
