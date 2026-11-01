// Central defaults and rules for timetable and wizard configuration.
// One place for constants with short explanations.

const DEFAULTS = {
  // Default working weekdays for school operations
  DEFAULT_DAYS: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],

  // Default number of teaching periods per school day
  DEFAULT_PERIOD_COUNT: 6,

  // Default duration of one teaching period in minutes
  DEFAULT_PERIOD_DURATION: 40,

  // Default quick class count in setup wizard
  DEFAULT_QUICK_CLASS_COUNT: 2,

  // Default custom weekday for early dismissal / special schedules
  DEFAULT_CUSTOM_DAY: 'Friday',

  // Maximum recommended subjects a teacher should handle before a soft warning is shown
  SOFT_SUBJECT_LIMIT_PER_TEACHER: 3,

  // Starting recommendation for weekly periods based on subject difficulty
  BASE_PERIODS_PER_WEEK: {
    easy: 2,
    medium: 3,
    difficult: 4
  },

  // Maximum suggested periods for any single subject per week
  MAX_SUGGESTED_PERIODS: 5
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = DEFAULTS;
}
if (typeof window !== 'undefined') {
  window.TT2_DEFAULTS = DEFAULTS;
}
