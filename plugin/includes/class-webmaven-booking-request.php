<?php
/**
 * The booking request form WPMaven makes when a site's design brings none of
 * its own: example content may be plain, never wrong.
 *
 * The site builder asks for it (create_form, intent "booking", the plan's
 * services, no designed spec) for every Bookings business whose pages hold no
 * form marked for bookings, and the theme's [wm_booking] shortcode shows it
 * where a page left its booking area empty. It used to offer twelve hourly
 * time slots, 09:00 to 18:00, that no owner had given, and its date and phone
 * fields were WPForms Pro fields, which WPForms Lite does not show: a visitor
 * could pick an invented slot and give no date.
 *
 * Now it asks, as the theme's own request form does: the service (the plan's
 * services, each with its own duration when the plan gives one; in words when
 * there are none), a preferred date and a preferred time (free text: WPForms
 * Lite shows text fields only, no date or time picker), the visitor's name,
 * email and phone, and notes. Under the time it says the business will
 * contact them to confirm, and its thank-you line says the request is in,
 * the words of the theme's paid-booking request form. Everything is in the
 * site's language: the language the build names (create_form's `language`),
 * else the site's locale; English for a language the table lacks.
 */

if (!defined('ABSPATH')) {
    exit;
}

final class WebMaven_Booking_Request {

    /** The form's words, keyed as the theme's own words are: zh-TW for Chinese in traditional characters, nb for Norwegian. */
    const WORDS = [
        'en' => ['service' => 'Service', 'date' => 'Preferred date', 'time' => 'Preferred time', 'name' => 'Name', 'email' => 'Email', 'phone' => 'Phone', 'notes' => 'Notes', 'submit' => 'Request a booking', 'note' => 'We will contact you to confirm your booking.', 'sent' => 'Thanks! Your booking request is in. We will contact you to confirm it.'],
        'es' => ['service' => 'Servicio', 'date' => 'Fecha preferida', 'time' => 'Hora preferida', 'name' => 'Nombre', 'email' => 'Correo electrónico', 'phone' => 'Teléfono', 'notes' => 'Notas', 'submit' => 'Solicitar reserva', 'note' => 'Te contactaremos para confirmar tu reserva.', 'sent' => '¡Gracias! Hemos recibido tu solicitud de reserva y te contactaremos para confirmarla.'],
        'fr' => ['service' => 'Prestation', 'date' => 'Date souhaitée', 'time' => 'Heure souhaitée', 'name' => 'Nom', 'email' => 'E-mail', 'phone' => 'Téléphone', 'notes' => 'Remarques', 'submit' => 'Demander une réservation', 'note' => 'Nous vous contacterons pour confirmer votre réservation.', 'sent' => 'Merci ! Votre demande de réservation est bien reçue. Nous vous contacterons pour la confirmer.'],
        'de' => ['service' => 'Leistung', 'date' => 'Wunschdatum', 'time' => 'Wunschuhrzeit', 'name' => 'Name', 'email' => 'E-Mail', 'phone' => 'Telefon', 'notes' => 'Anmerkungen', 'submit' => 'Buchung anfragen', 'note' => 'Wir melden uns bei dir, um deine Buchung zu bestätigen.', 'sent' => 'Danke! Deine Buchungsanfrage ist angekommen. Wir melden uns bei dir, um sie zu bestätigen.'],
        'it' => ['service' => 'Servizio', 'date' => 'Data preferita', 'time' => 'Orario preferito', 'name' => 'Nome', 'email' => 'Email', 'phone' => 'Telefono', 'notes' => 'Note', 'submit' => 'Richiedi una prenotazione', 'note' => 'Ti contatteremo per confermare la prenotazione.', 'sent' => 'Grazie! Abbiamo ricevuto la tua richiesta di prenotazione e ti contatteremo per confermarla.'],
        'pt' => ['service' => 'Serviço', 'date' => 'Data de preferência', 'time' => 'Horário de preferência', 'name' => 'Nome', 'email' => 'E-mail', 'phone' => 'Telefone', 'notes' => 'Observações', 'submit' => 'Solicitar reserva', 'note' => 'Vamos entrar em contato para confirmar sua reserva.', 'sent' => 'Obrigado! Recebemos sua solicitação de reserva e vamos entrar em contato para confirmá-la.'],
        'pl' => ['service' => 'Usługa', 'date' => 'Preferowana data', 'time' => 'Preferowana godzina', 'name' => 'Imię i nazwisko', 'email' => 'E-mail', 'phone' => 'Telefon', 'notes' => 'Uwagi', 'submit' => 'Poproś o rezerwację', 'note' => 'Skontaktujemy się z Tobą, aby potwierdzić rezerwację.', 'sent' => 'Dziękujemy! Otrzymaliśmy Twoją prośbę o rezerwację i skontaktujemy się z Tobą, aby ją potwierdzić.'],
        'ru' => ['service' => 'Услуга', 'date' => 'Желаемая дата', 'time' => 'Желаемое время', 'name' => 'Имя', 'email' => 'Эл. почта', 'phone' => 'Телефон', 'notes' => 'Комментарий', 'submit' => 'Отправить заявку', 'note' => 'Мы свяжемся с вами, чтобы подтвердить бронирование.', 'sent' => 'Спасибо! Ваша заявка на бронирование получена. Мы свяжемся с вами, чтобы её подтвердить.'],
        'nl' => ['service' => 'Dienst', 'date' => 'Gewenste datum', 'time' => 'Gewenste tijd', 'name' => 'Naam', 'email' => 'E-mail', 'phone' => 'Telefoon', 'notes' => 'Opmerkingen', 'submit' => 'Boeking aanvragen', 'note' => 'We nemen contact met je op om je boeking te bevestigen.', 'sent' => 'Bedankt! We hebben je boekingsaanvraag ontvangen en nemen contact met je op om die te bevestigen.'],
        'uk' => ['service' => 'Послуга', 'date' => 'Бажана дата', 'time' => 'Бажаний час', 'name' => 'Ім\'я', 'email' => 'Ел. пошта', 'phone' => 'Телефон', 'notes' => 'Коментар', 'submit' => 'Надіслати запит', 'note' => 'Ми зв\'яжемося з вами, щоб підтвердити бронювання.', 'sent' => 'Дякуємо! Ваш запит на бронювання отримано. Ми зв\'яжемося з вами, щоб його підтвердити.'],
        'cs' => ['service' => 'Služba', 'date' => 'Preferované datum', 'time' => 'Preferovaný čas', 'name' => 'Jméno', 'email' => 'E-mail', 'phone' => 'Telefon', 'notes' => 'Poznámka', 'submit' => 'Odeslat žádost o rezervaci', 'note' => 'Ozveme se vám, abychom rezervaci potvrdili.', 'sent' => 'Děkujeme! Vaši žádost o rezervaci jsme přijali a ozveme se vám, abychom ji potvrdili.'],
        'el' => ['service' => 'Υπηρεσία', 'date' => 'Προτιμώμενη ημερομηνία', 'time' => 'Προτιμώμενη ώρα', 'name' => 'Όνομα', 'email' => 'Email', 'phone' => 'Τηλέφωνο', 'notes' => 'Σημειώσεις', 'submit' => 'Αίτημα κράτησης', 'note' => 'Θα επικοινωνήσουμε μαζί σας για να επιβεβαιώσουμε την κράτησή σας.', 'sent' => 'Ευχαριστούμε! Λάβαμε το αίτημα κράτησής σας και θα επικοινωνήσουμε μαζί σας για να το επιβεβαιώσουμε.'],
        'ro' => ['service' => 'Serviciu', 'date' => 'Data preferată', 'time' => 'Ora preferată', 'name' => 'Nume', 'email' => 'E-mail', 'phone' => 'Telefon', 'notes' => 'Observații', 'submit' => 'Solicită o rezervare', 'note' => 'Te vom contacta pentru a-ți confirma rezervarea.', 'sent' => 'Mulțumim! Am primit cererea ta de rezervare și te vom contacta pentru a o confirma.'],
        'hu' => ['service' => 'Szolgáltatás', 'date' => 'Kívánt dátum', 'time' => 'Kívánt időpont', 'name' => 'Név', 'email' => 'E-mail', 'phone' => 'Telefon', 'notes' => 'Megjegyzés', 'submit' => 'Foglalás kérése', 'note' => 'Felvesszük veled a kapcsolatot, hogy megerősítsük a foglalást.', 'sent' => 'Köszönjük! Megkaptuk a foglalási kérésedet, és felvesszük veled a kapcsolatot a megerősítéshez.'],
        'ca' => ['service' => 'Servei', 'date' => 'Data preferida', 'time' => 'Hora preferida', 'name' => 'Nom', 'email' => 'Correu electrònic', 'phone' => 'Telèfon', 'notes' => 'Observacions', 'submit' => 'Sol·licitar una reserva', 'note' => 'Us contactarem per confirmar la reserva.', 'sent' => 'Gràcies! Hem rebut la vostra sol·licitud de reserva i us contactarem per confirmar-la.'],
        'tr' => ['service' => 'Hizmet', 'date' => 'Tercih edilen tarih', 'time' => 'Tercih edilen saat', 'name' => 'Ad soyad', 'email' => 'E-posta', 'phone' => 'Telefon', 'notes' => 'Notlar', 'submit' => 'Rezervasyon talep et', 'note' => 'Rezervasyonunuzu onaylamak için sizinle iletişime geçeceğiz.', 'sent' => 'Teşekkürler! Rezervasyon talebiniz bize ulaştı. Onaylamak için sizinle iletişime geçeceğiz.'],
        'sv' => ['service' => 'Tjänst', 'date' => 'Önskat datum', 'time' => 'Önskad tid', 'name' => 'Namn', 'email' => 'E-post', 'phone' => 'Telefon', 'notes' => 'Kommentar', 'submit' => 'Skicka bokningsförfrågan', 'note' => 'Vi kontaktar dig för att bekräfta din bokning.', 'sent' => 'Tack! Vi har tagit emot din bokningsförfrågan och kontaktar dig för att bekräfta den.'],
        'da' => ['service' => 'Ydelse', 'date' => 'Ønsket dato', 'time' => 'Ønsket tidspunkt', 'name' => 'Navn', 'email' => 'E-mail', 'phone' => 'Telefon', 'notes' => 'Bemærkninger', 'submit' => 'Send bookingforespørgsel', 'note' => 'Vi kontakter dig for at bekræfte din booking.', 'sent' => 'Tak! Vi har modtaget din bookingforespørgsel og kontakter dig for at bekræfte den.'],
        'fi' => ['service' => 'Palvelu', 'date' => 'Toivottu päivä', 'time' => 'Toivottu aika', 'name' => 'Nimi', 'email' => 'Sähköposti', 'phone' => 'Puhelin', 'notes' => 'Lisätiedot', 'submit' => 'Lähetä varauspyyntö', 'note' => 'Otamme sinuun yhteyttä vahvistaaksemme varauksesi.', 'sent' => 'Kiitos! Varauspyyntösi on vastaanotettu, ja otamme sinuun yhteyttä vahvistaaksemme sen.'],
        'nb' => ['service' => 'Tjeneste', 'date' => 'Ønsket dato', 'time' => 'Ønsket tidspunkt', 'name' => 'Navn', 'email' => 'E-post', 'phone' => 'Telefon', 'notes' => 'Kommentar', 'submit' => 'Send bestillingsforespørsel', 'note' => 'Vi kontakter deg for å bekrefte bestillingen.', 'sent' => 'Takk! Vi har mottatt bestillingsforespørselen din og kontakter deg for å bekrefte den.'],
        'ja' => ['service' => 'サービス', 'date' => 'ご希望の日付', 'time' => 'ご希望の時間', 'name' => 'お名前', 'email' => 'メールアドレス', 'phone' => '電話番号', 'notes' => 'ご要望', 'submit' => '予約をリクエスト', 'note' => 'ご予約の確定のため、こちらからご連絡いたします。', 'sent' => 'ありがとうございます！ご予約のリクエストを受け付けました。確定のため、こちらからご連絡いたします。'],
        'zh' => ['service' => '服务', 'date' => '希望日期', 'time' => '希望时间', 'name' => '姓名', 'email' => '电子邮箱', 'phone' => '电话', 'notes' => '备注', 'submit' => '提交预约请求', 'note' => '我们会联系您确认预约。', 'sent' => '谢谢！我们已收到您的预约请求，会联系您确认。'],
        'zh-TW' => ['service' => '服務', 'date' => '希望日期', 'time' => '希望時間', 'name' => '姓名', 'email' => '電子郵件', 'phone' => '電話', 'notes' => '備註', 'submit' => '送出預約請求', 'note' => '我們會與你聯繫以確認預約。', 'sent' => '謝謝！我們已收到你的預約請求，會與你聯繫確認。'],
        'ko' => ['service' => '서비스', 'date' => '희망 날짜', 'time' => '희망 시간', 'name' => '이름', 'email' => '이메일', 'phone' => '전화번호', 'notes' => '메모', 'submit' => '예약 요청하기', 'note' => '예약 확정을 위해 연락드리겠습니다.', 'sent' => '감사합니다! 예약 요청을 받았으며, 확정을 위해 연락드리겠습니다.'],
        'ar' => ['service' => 'الخدمة', 'date' => 'التاريخ المفضل', 'time' => 'الوقت المفضل', 'name' => 'الاسم', 'email' => 'البريد الإلكتروني', 'phone' => 'الهاتف', 'notes' => 'ملاحظات', 'submit' => 'اطلب حجزًا', 'note' => 'سنتواصل معك لتأكيد حجزك.', 'sent' => 'شكرًا لك! تلقّينا طلب الحجز وسنتواصل معك لتأكيده.'],
        'he' => ['service' => 'שירות', 'date' => 'תאריך מועדף', 'time' => 'שעה מועדפת', 'name' => 'שם', 'email' => 'אימייל', 'phone' => 'טלפון', 'notes' => 'הערות', 'submit' => 'שליחת בקשה להזמנה', 'note' => 'ניצור איתך קשר כדי לאשר את ההזמנה.', 'sent' => 'תודה! בקשת ההזמנה שלך התקבלה, וניצור איתך קשר כדי לאשר אותה.'],
        'fa' => ['service' => 'خدمت', 'date' => 'تاریخ دلخواه', 'time' => 'ساعت دلخواه', 'name' => 'نام', 'email' => 'ایمیل', 'phone' => 'تلفن', 'notes' => 'توضیحات', 'submit' => 'درخواست رزرو', 'note' => 'برای تأیید رزرو با شما تماس می‌گیریم.', 'sent' => 'سپاس! درخواست رزرو شما رسید و برای تأیید آن با شما تماس می‌گیریم.'],
        'ur' => ['service' => 'سروس', 'date' => 'پسندیدہ تاریخ', 'time' => 'پسندیدہ وقت', 'name' => 'نام', 'email' => 'ای میل', 'phone' => 'فون', 'notes' => 'نوٹس', 'submit' => 'بکنگ کی درخواست بھیجیں', 'note' => 'بکنگ کی تصدیق کے لیے ہم آپ سے رابطہ کریں گے۔', 'sent' => 'شکریہ! آپ کی بکنگ کی درخواست موصول ہو گئی ہے، اور تصدیق کے لیے ہم آپ سے رابطہ کریں گے۔'],
    ];

    /** The WORDS key of a language code or a WordPress locale (es, pt-BR, zh-Hant, zh_TW, nb_NO, no): English for one the table lacks. */
    public static function language(string $code): string {
        $parts = preg_split('/[_\-]/', strtolower(trim($code)));
        $base = $parts[0] ?? '';
        if ($base === 'zh') {
            return array_intersect(array_slice($parts, 1), ['tw', 'hk', 'mo', 'hant']) ? 'zh-TW' : 'zh';
        }
        if ($base === 'no') {
            return 'nb';
        }
        return isset(self::WORDS[$base]) ? $base : 'en';
    }

    /** The form's words in a language: the one the build names, else the site's locale. */
    public static function words(string $language = ''): array {
        $code = trim($language) !== '' ? $language : (function_exists('get_locale') ? (string) get_locale() : '');
        return self::WORDS[self::language($code)];
    }

    /**
     * The request form: its fields (the create_form shape), its button and its
     * thank-you line. $services: the plan's services, names or {name,
     * duration}; a duration is shown only when the plan gives one.
     */
    public static function form(array $services, string $language = ''): array {
        $w = self::words($language);
        $choices = [];
        foreach ($services as $service) {
            $name = sanitize_text_field(is_array($service) ? ($service['name'] ?? '') : (string) $service);
            $minutes = is_array($service) ? (int) ($service['duration'] ?? 0) : 0;
            if ($name !== '' && !in_array($name, $choices, true)) {
                $choices[] = $minutes > 0 ? $name . ' (' . $minutes . ' min)' : $name;
            }
        }
        $fields = [
            $choices
                ? ['label' => $w['service'], 'type' => 'select', 'required' => true, 'options' => $choices]
                : ['label' => $w['service'], 'type' => 'text', 'required' => true],
            // Text, not WPForms' Date/Time field: WPForms Lite does not show it.
            ['label' => $w['date'], 'type' => 'text', 'required' => true],
            ['label' => $w['time'], 'type' => 'text', 'required' => false, 'description' => $w['note']],
            ['label' => $w['name'], 'type' => 'text', 'required' => true],
            ['label' => $w['email'], 'type' => 'email', 'required' => true],
            // Text, not WPForms' Phone field (a Pro field Lite does not show).
            ['label' => $w['phone'], 'type' => 'text', 'required' => false],
            ['label' => $w['notes'], 'type' => 'textarea', 'required' => false],
        ];
        return ['fields' => $fields, 'submit' => $w['submit'], 'confirmation' => $w['sent']];
    }
}
