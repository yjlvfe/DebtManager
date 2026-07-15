# مدير الديون 💰

**تطبيق إدارة الديون والمحاسبة** — تطبيق Electron سطح المكتب لإدارة الديون، تتبع المدفوعات، وإنشاء تقارير PDF بالعربية.

---

## ✨ المميزات

- 📝 **تسجيل الديون** — إضافة وحذف وتعديل السندات المالية
- 💳 **تتبع المدفوعات** — تسجيل الدفعات الجزئية والكلية
- 📊 **رسم بياني** — عرض مرئي لحالة الديون باستخدام Chart.js
- 📄 **تقارير PDF** — إنشاء تقارير احترافية بخط عربي (Amiri) عبر PDFKit
- 💾 **قاعدة بيانات محلية** — SQLite عبر better-sqlite3
- 🖥️ **سطح المكتب** — تطبيق Electron يعمل بدون إنترنت

---

## 📋 المتطلبات

- **OS:** Windows 10/11 (x64)
- **Node.js:** v18+
- **npm:** v9+

---

## 🚀 التشغيل

```bash
git clone https://github.com/yjlvfe/DebtManager.git
cd DebtManager
npm install
npm start
```

### البناء

```bash
# ملف portable.exe للويندوز
npm run build

# النتيجة: dist/مدير الديون 1.0.0.exe
```

---

## 🏗️ هيكل المشروع

```
DebtManager/
├── main.js                 # Electron main process
├── preload.js              # Context bridge
├── renderer.js             # منطق الواجهة
├── database.js             # إدارة SQLite
├── index.html              # واجهة المستخدم
├── style.css               # الأنماط
├── lib/
│   └── chart.umd.min.js    # Chart.js للرسوم البيانية
├── assets/
│   └── fonts/
│       └── Amiri-Regular.ttf  # خط عربي للتقارير
├── build/
│   ├── icon.ico            # أيقونة الوينندوز
│   └── icon.png            # أيقونة عامة
├── package.json
└── .gitignore
```

---

## ⚙️ الإعدادات

| الإعداد | الوصف |
|---------|-------|
| قاعدة البيانات | ملف SQLite محلي داخل مجلد المستخدم |
| اللغة | عربية |
| العملة | ريال سعودي (SAR) |

---

## 📄 الرخصة

MIT License — انظر ملف [LICENSE](LICENSE)

---

## 🤝 المؤلف

**YJLVFE** — [github.com/yjlvfe](https://github.com/yjlvfe)
