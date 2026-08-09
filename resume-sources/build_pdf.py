# -*- coding: utf-8 -*-
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import cm, mm
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT
from reportlab.platypus import (SimpleDocTemplate, Table, TableStyle, Paragraph,
                                Spacer, ListFlowable, ListItem, HRFlowable, KeepTogether)
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont

# ---------- Font ----------
try:
    pdfmetrics.registerFont(UnicodeCIDFont('STSong-Light'))
    BASE = 'STSong-Light'
except Exception:
    BASE = 'Helvetica'

# ---------- Palette ----------
PRIMARY = colors.HexColor('#1F3A5F')   # navy
ACCENT  = colors.HexColor('#2E86AB')   # blue
LIGHT   = colors.HexColor('#EEF3F8')   # light blue-gray
TEXT    = colors.HexColor('#222222')
SUB     = colors.HexColor('#5A5A5A')
WHITE   = colors.white
HEADTXT = colors.HexColor('#DCE6F2')

# ---------- Styles ----------
nameStyle = ParagraphStyle('name', fontName=BASE, fontSize=21, leading=24,
                           textColor=WHITE, spaceAfter=1)
titleStyle = ParagraphStyle('title', fontName=BASE, fontSize=11.5, leading=14,
                            textColor=HEADTXT, spaceAfter=3)
contactStyle = ParagraphStyle('contact', fontName=BASE, fontSize=9.2, leading=12.5,
                              textColor=HEADTXT)
hStyle = ParagraphStyle('h', fontName=BASE, fontSize=12.5, leading=15,
                        textColor=PRIMARY, spaceBefore=7, spaceAfter=3.5)
bodyStyle = ParagraphStyle('body', fontName=BASE, fontSize=9.0, leading=12.6,
                           textColor=TEXT, alignment=TA_LEFT)
techStyle = ParagraphStyle('tech', fontName=BASE, fontSize=8.6, leading=12,
                           textColor=ACCENT)
jobTitleStyle = ParagraphStyle('job', fontName=BASE, fontSize=10.0, leading=13,
                               textColor=PRIMARY)
bulletStyle = ParagraphStyle('bullet', fontName=BASE, fontSize=9.0, leading=12.4,
                             textColor=TEXT, leftIndent=10, spaceAfter=0.5)

# ---------- Helpers ----------
def section_heading(text):
    sq = Table([['']], colWidths=[4*mm], rowHeights=[5.5*mm])
    sq.setStyle(TableStyle([('BACKGROUND', (0,0), (-1,-1), PRIMARY),
                            ('VALIGN', (0,0), (-1,-1), 'MIDDLE')]))
    txt = Paragraph(text, hStyle)
    row = Table([[sq, txt]], colWidths=[5*mm, None])
    row.setStyle(TableStyle([('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
                             ('LEFTPADDING', (1,0), (1,0), 3),
                             ('TOPPADDING', (0,0), (-1,-1), 0),
                             ('BOTTOMPADDING', (0,0), (-1,-1), 0)]))
    return row

def bullets(items, color=ACCENT):
    lis = [ListItem(Paragraph(b, bulletStyle), value='•') for b in items]
    return ListFlowable(lis, bulletType='bullet', leftIndent=12,
                        bulletColor=color, bulletFontSize=8)

def job_entry(company, role, period, items):
    head = Paragraph(f'{company}　<font color="#2E86AB">{role}</font>　'
                     f'<font color="#999999">| {period}</font>', jobTitleStyle)
    return [head, Spacer(1, 2), bullets(items), Spacer(1, 3)]

def project_entry(title, period, tech, desc, items, perf):
    out = []
    out.append(Paragraph(f'{title}　<font color="#999999">| {period}</font>', jobTitleStyle))
    out.append(Paragraph(f'技术栈：{tech}', techStyle))
    if desc:
        out.append(Paragraph(desc, bodyStyle))
    if items:
        out.append(bullets(items))
    if perf:
        out.append(Paragraph(f'<font color="#555555">业绩：</font>{perf}', bodyStyle))
    out.append(Spacer(1, 4))
    return out

# ---------- Content ----------
story = []

# Header card
header = Table([[Paragraph('金道洋', nameStyle)],
                [Paragraph('前端开发工程师', titleStyle)],
                [Paragraph('男 · 33岁 · 籍贯：黄石 · 18898355832 · Jindy0706@gmail.com', contactStyle)],
                [Paragraph('10 年工作经验　|　求职意向：前端开发工程师　|　期望城市：武汉', contactStyle)]],
               colWidths=[504.57])
header.setStyle(TableStyle([
    ('BACKGROUND', (0,0), (-1,-1), PRIMARY),
    ('LEFTPADDING', (0,0), (-1,-1), 14),
    ('RIGHTPADDING', (0,0), (-1,-1), 14),
    ('TOPPADDING', (0,0), (0,0), 12),
    ('BOTTOMPADDING', (0,-1), (-1,-1), 12),
    ('TOPPADDING', (0,1), (-1,-1), 1),
    ('BOTTOMPADDING', (0,0), (0,-2), 1),
    ('LINEBEFORE', (0,1), (0,-1), 0, PRIMARY),
]))
story.append(header)
story.append(Spacer(1, 6))

# 个人优势
story.append(section_heading('个人优势'))
adv = [
    '拥有 11 年一线 Web 前端全流程开发实战经验，独立主导多个商业化大型项目完整生命周期开发，精通需求拆解、技术选型、落地迭代与线上运维，对企业级系统开发流程有成熟把控。',
    '精通 Vue、React 主流前端框架，熟悉 Angular 基础使用，可根据业务场景灵活匹配技术栈；持续跟进前端行业新技术，具备快速落地新技术的学习与落地能力。',
    '擅长独立排查复杂业务场景技术难题，承接紧急攻坚项目并按期交付；抗压能力强，线上故障应急处理、疑难 bug 解决经验充足。',
    '长期协同产品、UI、后端、测试多部门跨团队协作，高效推进需求评审、接口联调、版本上线全流程，沟通推进能力突出。',
    '代码编写严谨，重视代码可维护性与页面性能，常态化开展代码审查、单元测试，持续优化团队整体代码质量。',
]
story.append(bullets(adv))
story.append(Spacer(1, 2))

# 专业技能
story.append(section_heading('专业技能'))
skills = [
    '基础技术：HTML5、CSS3、JavaScript/ES6+、Sass/Less 预编译、响应式布局、移动端 H5 开发、浏览器兼容适配（IE11 及低版本）',
    '主流框架：Vue2/Vue3 全家桶、React、Angular（基础）、jQuery、Zepto',
    '工程化与构建：Webpack、Vite、Gzip、Tree Shaking、Axios、Git、SVN、Jenkins 自动化部署、Postman 接口调试',
    '进阶能力：RESTful 接口规范封装、全局请求拦截、动态权限路由、qiankun 微前端、大数据虚拟滚动、前端性能专项优化、组件化 / 低代码（牛刀）开发',
    '其他：Node.js、ECharts 数据可视化、Swiper 等工具库',
]
story.append(bullets(skills))
story.append(Spacer(1, 2))

# 工作经历
story.append(section_heading('工作经历'))
story += job_entry('厦门方胜众合企业服务有限公司深圳分公司', '前端开发工程师', '2022.03 - 2025.07', [
    '根据产品需求与 UI 设计稿独立完成全页面开发，使用 HTML5/CSS3/JS 实现响应式布局与复杂交互，保障 PC、移动端多设备兼容与页面性能稳定。',
    '对接后端 API 文档完成接口联调，基于 Axios 封装异步请求，协同后端解决开发、生产环境跨域问题，优化前后端数据传输效率。',
    '开展系统长期性能优化与代码重构工作，精简冗余 DOM 操作，整体页面加载速度提升 30%，页面渲染效率显著提高。',
    '专项修复历史遗留浏览器兼容问题，完成 IE11 及低版本浏览器适配改造，保障平台核心业务在全主流浏览器正常运行。',
])
story += job_entry('深圳建广数字科技有限公司', 'Web 前端', '2021.10 - 2021.12', [
    '参与客户需求评审，评估前端技术实现可行性，提前规避开发风险。',
    '独立完成项目基础技术框架搭建，负责全页面开发，保障系统运行稳定、交付高效。',
    '全程配合后端团队接口联调，校验数据一致性，保证接口交互流畅。',
    '完成功能自测、线上 bug 修复，把控产品交付质量与用户体验。',
])
story += job_entry('深圳市云客派科技有限公司', 'Web 前端', '2020.05 - 2021.10', [
    '独立承接前端开发需求，按时高质量交付项目，客户整体满意度达 95% 以上。',
    '协同后端完成接口联调与功能测试，保证数据传输稳定，团队前后端协作效率提升 30%。',
    '统筹版本迭代与上线流程，引入自动化部署工具，代码上线耗时缩短 20%，建立线上问题快速定位机制。',
    '推行组件化开发模式，通用代码复用率提升 40%；持续做页面性能迭代，页面加载速度提升 15%。',
])
story += job_entry('深圳市思迪信息技术股份有限公司', 'Web 前端', '2016.06 - 2020.05', [
    '依据客户需求独立完成 PC、App、H5 页面开发、功能迭代与线上性能优化，严格匹配业务预期效果。',
    '配合后端完成各类业务场景接口联调，保障系统稳定、数据准确。',
    '负责项目版本发布全流程，及时处理上线期间突发故障，保障业务平稳迭代。',
])

# 项目经历
story.append(section_heading('项目经历'))
story += project_entry('合约系统', '2024.07 - 2025.06',
    'Vue3 定制化开发 + 牛刀低代码（混合开发模式）',
    '面向建筑工程在建 / 未完结地盘的支出管控场景，完成原有合约系统前端架构重构，打造集粮单管理、合约管理、分判商管理、权限管控于一体的数字化填报平台。',
    ['独立主导前端全生命周期开发，采用「Vue3 定制化开发 + 低代码快速搭建」混合模式，封装通用业务组件与表单。',
     '负责核心模块开发、性能优化与线上运维，保障系统稳定交付。'],
    '项目按期交付，已正式上线运营并持续迭代。')
story += project_entry('路衍商城 H5', '2021.11 - 2022.12',
    'Vue 全家桶',
    'H5 商城项目，主要功能包括商品列表、商品详情、加入购物车、付款、查看订单状态等。',
    ['负责商城各页面的前端开发；',
     '对接后端接口完成联调，保障交易流程顺畅。'], None)
story += project_entry('招商运营平台', '2021.04 - 2021.07',
    'Vue 全家桶 + qiankun + ElementUI',
    '对插件进行管理与配置、权限分配与管理、奖励分配与管理；积分商城插件支持用户在 App 或小程序访问，查看并兑换积分物品。',
    ['根据原型图或设计图完成页面布局及交互；',
     '与后端完成接口联调；',
     '负责项目维护、代码优化及公共方法封装。'],
    '已发布运营（未对外开放）。')
story += project_entry('华泰运营平台', '2020.11 - 2021.04',
    'Vue 全家桶 + qiankun + ElementUI',
    '管理与配置插件、权限管理及分配、审核、奖品分配及管理；模拟炒股支持买卖、查看行情、收益榜单、关注牛人动态，完成任务获得奖励。',
    ['根据设计图完成页面布局及交互；',
     '与后端联调；',
     '项目维护、组件二次封装与工具类编写；',
     '解决平台兼容问题。'],
    '项目已上线。')
story += project_entry('递四方轨迹中心', '2020.07 - 2020.08',
    'ant-design-vue + vuex + vue-router',
    '让用户清晰掌握包裹运输轨迹的查询平台。',
    ['完成页面布局与交互、接口联调及项目维护。'],
    '项目已上线（track.4px.com）。')
story += project_entry('递四方商家中心', '2020.09 - 2020.10',
    'React + 飞冰（ICE）',
    '按老版系统做前后端分离并优化，集合递四方全部业务（转运、退货、海外服务），方便用户充值、查询、下单、接收消息等综合管理。',
    ['负责服务中心与消息中心的页面布局、交互及接口联调。'],
    '已成功上线（b.4px.com）。')
story += project_entry('金融证券开户 / 交易系统（红塔、华安、川财证券 H5 双向开户；申万宏源 VTM 开户；华安徽赢 App）',
    '2018.01 - 2020.01',
    'Zepto / jQuery + Canvas / HTML5 + JS / CSS',
    '覆盖非现场 H5 开户（身份证上传、视频见证、协议签署验签）、VTM 智能硬件开户（身份证 / 银行卡认证、语音视频确认）及综合证券 App（交易、投顾、业务办理、开户一体）。',
    ['负责与第三方 / 厂商的硬件及接口联调；',
     '负责页面开发、交互实现、新需求开发及线上问题修复；',
     '处理多端浏览器兼容与 App 兼容问题。'],
    '多项目上线稳定运行，非现场开户系统让用户免临柜、免下载 App 便捷开户。')

# 教育经历
edu = [
    '西南交通大学　|　本科　|　工商管理　|　2017 - 2022',
    '武汉工程大学　|　大专　|　机电一体化　|　2015 - 2017',
]
story.append(KeepTogether([section_heading('教育经历'), bullets(edu)]))

# ---------- Build ----------
out = "/Users/jindy/WorkBuddy/learning-AI/resume-sources/金道洋-前端开发工程师-合并优化版.pdf"
doc = SimpleDocTemplate(out, pagesize=A4,
                        leftMargin=1.6*cm, rightMargin=1.6*cm,
                        topMargin=1.4*cm, bottomMargin=1.4*cm,
                        title='金道洋 - 前端开发工程师 简历',
                        author='金道洋')
doc.build(story)
print("PDF generated:", out)
