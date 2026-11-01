/**
 * Central Navigation Configuration for The Eye
 * Defines the tabs and sub-items for each portal role.
 * Short, simple labels and clear descriptions.
 */
var MENU_CONFIG = {
  admin: [
    { id: 'tab-teachers', label: 'Teachers', icon: 'fa-chalkboard-user', href: '#tab-teachers', dataSection: 'tab-teachers', dataFeatureKey: 'teacher_management' },
    { id: 'tab-students', label: 'Students', icon: 'fa-user-graduate', href: '#tab-students', dataSection: 'tab-students', dataFeatureKey: 'student_management' },
    { id: 'tab-classes', label: 'Classes', icon: 'fa-book', href: '#tab-classes', dataSection: 'tab-classes' },
    { id: 'tab-attendance', label: 'Attendance', icon: 'fa-clipboard-list', href: '#tab-attendance', dataSection: 'tab-attendance' },
    { id: 'tab-stats', label: 'Stats', icon: 'fa-chart-bar', href: '#tab-stats', dataSection: 'tab-stats' },
    { id: 'tab-announcements', label: 'Announcements', icon: 'fa-bullhorn', href: '#tab-announcements', dataSection: 'tab-announcements' },
    { id: 'tab-fees', label: 'Fees', icon: 'fa-money-bill-wave', href: '#tab-fees', dataSection: 'tab-fees', dataFeatureKey: 'fees' },
    {
      id: 'tab-automated',
      label: 'Automated',
      icon: 'fa-wand-magic-sparkles',
      dropdown: [
        {
          label: 'Generate Time Table',
          desc: 'Makes the weekly class timetable.',
          href: '/tt2/'
        },
        {
          label: 'Generate Date Sheet',
          desc: 'Makes the exam dates for your classes.',
          href: '#',
          toast: 'Generate Date Sheet will be available soon'
        }
      ]
    },
    {
      id: 'tab-complaints-menu',
      label: 'Complaints',
      icon: 'fa-circle-exclamation',
      dropdown: [
        {
          label: 'Teacher complaints',
          desc: 'Complaints submitted by teachers.',
          href: '#',
          toast: 'Complaints will be available soon'
        },
        {
          label: 'Student complaints',
          desc: 'Complaints submitted by students.',
          href: '#',
          toast: 'Complaints will be available soon'
        }
      ]
    },
    { id: 'branchesTabBtn', label: 'Branches', icon: 'fa-building', href: '#tab-branches', dataSection: 'tab-branches', optional: true },
    { id: 'coordinatorsTabBtn', label: 'Coordinators', icon: 'fa-user-shield', href: '#tab-coordinators', dataSection: 'tab-coordinators' }
  ],

  teacher: [
    { id: 'tab-attendance-btn', label: 'Attendance', icon: 'fa-clipboard-check', href: '#tab-attendance', dataSection: 'tab-attendance' },
    { id: 'tab-announcements-btn', label: 'Announcements', icon: 'fa-bullhorn', href: '#tab-announcements', dataSection: 'tab-announcements' },
    { id: 'tab-homework-btn', label: 'Homework', icon: 'fa-book', href: '#tab-homework', dataSection: 'tab-homework' },
    { id: 'tab-stats-btn', label: 'Stats & Statistics', icon: 'fa-chart-bar', href: '#tab-stats', dataSection: 'tab-stats' },
    { id: 'tab-complaint-btn', label: 'Complaint', icon: 'fa-circle-exclamation', href: '/complaint.html', dataSection: 'tab-complaint' }
  ],

  student: [
    { id: 'tab-teacher-btn', label: 'Teacher', icon: 'fa-chalkboard-user', href: '#tab-teacher', dataSection: 'tab-teacher' },
    { id: 'tab-attendance-btn', label: 'Attendance', icon: 'fa-clipboard-check', href: '#tab-attendance', dataSection: 'tab-attendance' },
    { id: 'tab-homework-btn', label: 'Homework', icon: 'fa-book-open', href: '#tab-homework', dataSection: 'tab-homework' },
    { id: 'tab-announcements-btn', label: 'Announcements', icon: 'fa-bullhorn', href: '#tab-announcements', dataSection: 'tab-announcements' },
    { id: 'tab-fees-btn', label: 'Fees', icon: 'fa-money-bill-wave', href: '#tab-fees', dataSection: 'tab-fees' },
    { id: 'tab-complaint-btn', label: 'Complaint', icon: 'fa-circle-exclamation', href: '/complaint.html', dataSection: 'tab-complaint' }
  ],

  coordinator: [
    { id: 'navMark', label: 'Take attendance', icon: 'fa-clipboard-check', href: '#mark', action: "switchSubTab('mark')", active: true },
    { id: 'navRecords', label: 'Saved records', icon: 'fa-clock-rotate-left', href: '#records', action: "switchSubTab('records')" },
    { id: 'navAnnouncements', label: 'Announcements', icon: 'fa-bullhorn', href: '#announcements', action: "switchSubTab('announcements')" }
  ]
};

if (typeof window !== 'undefined') {
  window.MENU_CONFIG = MENU_CONFIG;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = MENU_CONFIG;
}
